import { Prisma } from "@prisma/client";
import { BOOKABLE_SPOT } from "../lib/bookable-spot.js";
import { publicName } from "../lib/display-name.js";
import { badRequest, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { cheapestStay, driverFees, stayPrice } from "../lib/stay-price.js";
import { daySegments, windowsCover } from "../lib/venue-time.js";
import * as reviewService from "./review.service.js";
import * as monthlyService from "./monthly.service.js";
import { addMonths, termOverlapsRange } from "../lib/monthly.js";
import { termClaiming, termsTouching } from "../lib/monthly-guard.js";
import { addDays, startOfVenueDay, venueDate } from "../lib/venue-calendar.js";
import { bookingRuleSelect, ruleViolation, startTooFar } from "../lib/booking-rules.js";
import { approximate } from "../lib/location-privacy.js";

const KM_PER_LAT_DEGREE = 111.045;

/** How many candidates the SQL returns before the per-day check narrows them. */
const CANDIDATE_CAP = 60;

export interface NearbyFilters {
  latitude: number;
  longitude: number;
  radiusKm: number;
  /** When the driver needs the spot. Defaults to now. */
  at?: Date;
  /** How long for, in minutes. The spot has to be open, and free, for all of it. */
  durationMinutes?: number;
  /** Only spots priced for this vehicle. Absent means any, at its best rate. */
  vehicleType?: string;
  limit?: number;
  /**
   * A recurring search instead of a one-off stay: these weekdays, between
   * these minutes, every week. Present means monthly.
   *
   * A spot qualifies only if it is open across the whole range on *every* one
   * of these days, and offers a monthly price.
   */
  days?: number[];
  startMinute?: number;
  endMinute?: number;
  /** Monthly only: the term's first day (venue date) and length. */
  startDate?: string;
  months?: number;
  /** The driver's car size: spaces that fit a smaller car are left out. */
  vehicleSize?: string;
  /** Every one of these must be offered. */
  amenities?: string[];
  /** Any of these. */
  spaceTypes?: string[];
  maxPricePerHour?: number;
  /** Open every day, all day. */
  open24x7?: boolean;
  /** Average of visible reviews at least this; unrated spots don't qualify. */
  minRating?: number;
  sort?: "distance" | "price";
}

export interface NearbySpot {
  id: string;
  name: string;
  venueName: string;
  city: string;
  /** The locality, public ("Kothrud"). */
  area: string | null;
  /** DRIVEWAY / GARAGE / CAR_PARK / PRIVATE_LOT / SOCIETY / COMMERCIAL / OTHER. */
  spaceType: string | null;
  /** The first photo in the host's order, or null when there is none. */
  coverPhotoUrl: string | null;
  /** Rounded to ~100 m (lib/location-privacy); the exact pin comes with payment. */
  latitude: number;
  longitude: number;
  /** From the exact point. */
  distanceKm: number;
  /** The cheapest of the spot's rates -- "from", when there is more than one. Null when it isn't rented by the hour. */
  pricePerHour: number | null;
  pricePerDay: number | null;
  pricePerMonth: number | null;
  /** What this stay costs at the cheapest rate; null on a monthly search. */
  stayTotal: string | null;
  /** Which vehicles it prices, so a car driver can tell a bike stand from a list. */
  vehicleTypes: string[];
  amenities: string[];
  /** Open all day, every day -- derived from the hours, never stored. */
  open24x7: boolean;
  /** Whether the driver searching has saved it. */
  saved: boolean;
  availableUntilMinute: number;
  /** Average stars, one decimal; null until somebody has reviewed it. */
  rating: number | null;
  reviewCount: number;
}

/**
 * Host spots bookable around a point, for a given stay.
 *
 * Two passes. SQL narrows by place, the gates, the filters, the first day of
 * the stay and -- new -- whether the hours are already taken, so a spot that
 * somebody else has booked no longer appears only to fail at checkout. Then
 * each candidate's opening hours are checked across every day the stay
 * touches, which a single SQL join over one weekday cannot express for a stay
 * that runs past midnight.
 *
 * Ordered by distance (or price) and capped, with no cursor: a radius search
 * is a short, position-dependent list.
 */
export async function nearby(filters: NearbyFilters, viewerId: string): Promise<NearbySpot[]> {
  const limit = filters.limit ?? 20;
  const monthly = filters.days !== undefined && filters.days.length > 0;
  const start = filters.at ?? new Date();
  const minutes = filters.durationMinutes ?? 60;
  const end = new Date(start.getTime() + minutes * 60_000);
  const first = daySegments(start, end)[0];

  const availabilityJoin = monthly
    ? Prisma.sql`
        AND ha."dayOfWeek" = ANY(${filters.days}::int[])
        AND ha."startMinute" <= ${filters.startMinute ?? 0}
        AND ha."endMinute" >= ${filters.endMinute ?? 1440}
      `
    : Prisma.sql`
        AND ha."dayOfWeek" = ${first.dayOfWeek}
        AND ha."startMinute" <= ${first.startMinute}
        AND ha."endMinute" >= ${first.endMinute}
      `;

  const everyDayCovered = monthly
    ? Prisma.sql`AND COUNT(DISTINCT ha."dayOfWeek") = ${filters.days!.length}`
    : Prisma.empty;

  // Somebody else's paid booking, or a hold still being paid for, over any
  // part of this stay. The same statuses the overlap guard protects.
  const notTaken = monthly
    ? Prisma.empty
    : Prisma.sql`
        AND NOT EXISTS (
          SELECT 1 FROM "Booking" b
          WHERE b."listingId" = l."id"
            AND tsrange(b."startsAt", b."endsAt") && tsrange(${start}::timestamp, ${end}::timestamp)
            AND (b."status" = 'CONFIRMED' OR (b."status" = 'PENDING' AND b."holdExpiresAt" > now()))
        )
        -- Nor hours the host has blocked.
        AND NOT EXISTS (
          SELECT 1 FROM "ListingBlock" lb
          WHERE lb."listingId" = l."id"
            AND tsrange(lb."startsAt", lb."endsAt") && tsrange(${start}::timestamp, ${end}::timestamp)
        )
      `;

  const latDelta = filters.radiusKm / KM_PER_LAT_DEGREE;
  const lngDelta =
    filters.radiusKm /
    (KM_PER_LAT_DEGREE * Math.max(Math.cos((filters.latitude * Math.PI) / 180), 0.01));

  // A stay needs an hourly or a daily rate; a monthly-only space answers only
  // monthly searches.
  const pricingFilter = Prisma.sql`
    ${filters.vehicleType ? Prisma.sql`AND sp."vehicleType" = ${filters.vehicleType}` : Prisma.empty}
    ${monthly ? Prisma.sql`AND sp."pricePerMonth" IS NOT NULL` : Prisma.sql`AND (sp."pricePerHour" IS NOT NULL OR sp."pricePerDay" IS NOT NULL)`}
  `;

  // SUVs and vans are sizes of car: a space fits the driver's car when it has
  // no size limit or its limit is at least that size.
  const sizes = ["HATCHBACK", "SEDAN", "SUV", "VAN"];
  const sizeFilter =
    filters.vehicleSize && filters.vehicleType !== "BIKE"
      ? Prisma.sql`AND (l."maxVehicleSize" IS NULL OR array_position(${sizes}::text[], l."maxVehicleSize") >= array_position(${sizes}::text[], ${filters.vehicleSize}::text))`
      : Prisma.empty;

  const open24x7 = Prisma.sql`(
    SELECT COUNT(DISTINCT h."dayOfWeek") FROM "HostAvailability" h
    WHERE h."listingId" = l."id" AND h."isActive" = true
      AND h."startMinute" = 0 AND h."endMinute" >= 1440
  ) = 7`;

  const listingFilters = Prisma.sql`
    ${filters.amenities?.length ? Prisma.sql`AND l."amenities" @> ${filters.amenities}::text[]` : Prisma.empty}
    ${filters.spaceTypes?.length ? Prisma.sql`AND l."spaceType" = ANY(${filters.spaceTypes}::text[])` : Prisma.empty}
    ${filters.open24x7 ? Prisma.sql`AND ${open24x7}` : Prisma.empty}
    ${sizeFilter}
    ${
      filters.minRating !== undefined
        ? Prisma.sql`AND (
            SELECT AVG(r."rating") FROM "Review" r
            WHERE r."listingId" = l."id" AND r."hiddenAt" IS NULL
          ) >= ${filters.minRating}`
        : Prisma.empty
    }
  `;

  const priceCap =
    filters.maxPricePerHour !== undefined
      ? Prisma.sql`AND MIN(sp."pricePerHour") <= ${filters.maxPricePerHour}`
      : Prisma.empty;

  const distance = Prisma.sql`
    6371 * acos(LEAST(1, GREATEST(-1,
      sin(radians(${filters.latitude}::float8)) * sin(radians(l."latitude"::float8))
      + cos(radians(${filters.latitude}::float8)) * cos(radians(l."latitude"::float8))
        * cos(radians(l."longitude"::float8) - radians(${filters.longitude}::float8))
    )))
  `;

  const rows = await prisma.$queryRaw<Omit<NearbySpot, "stayTotal" | "rating" | "reviewCount">[]>(Prisma.sql`
    SELECT
      l."id",
      l."name",
      l."venueName",
      l."city",
      l."area",
      l."spaceType",
      l."amenities",
      -- A correlated subquery rather than a join: a join would multiply the
      -- rows the aggregates below run over, once per photo.
      (
        SELECT p."url" FROM "SpotPhoto" p
        WHERE p."listingId" = l."id"
        ORDER BY p."position" ASC, p."createdAt" ASC
        LIMIT 1
      ) AS "coverPhotoUrl",
      round(l."latitude", 3)::float8 AS "latitude",
      round(l."longitude", 3)::float8 AS "longitude",
      ${distance} AS "distanceKm",
      MIN(sp."pricePerHour")::float8 AS "pricePerHour",
      MIN(sp."pricePerDay")::float8 AS "pricePerDay",
      MIN(sp."pricePerMonth")::float8 AS "pricePerMonth",
      -- DISTINCT because the availability join repeats each rate once per
      -- matching window.
      ARRAY_AGG(DISTINCT sp."vehicleType" ORDER BY sp."vehicleType") AS "vehicleTypes",
      MAX(ha."endMinute")::int AS "availableUntilMinute",
      ${open24x7} AS "open24x7",
      EXISTS (
        SELECT 1 FROM "Favorite" f WHERE f."listingId" = l."id" AND f."userId" = ${viewerId}
      ) AS "saved"
    FROM "Listing" l
    JOIN "HostProfile" hp ON hp."id" = l."hostProfileId"
    -- The join is the availability filter: a listing with no active window
    -- covering the requested time produces no rows.
    JOIN "HostAvailability" ha
      ON ha."listingId" = l."id"
     AND ha."isActive" = true
     ${availabilityJoin}
    -- Also a filter: a spot with no rate for the driver's vehicle cannot be
    -- booked, so it is not shown.
    JOIN "SpotPricing" sp
      ON sp."listingId" = l."id"
     ${pricingFilter}
    WHERE l."listingType" = 'INDEPENDENT_SPOT'
      AND l."status" = 'PUBLISHED'
      -- A host who paused new bookings is not in search at all.
      AND l."bookingsPausedAt" IS NULL
      AND hp."verificationStatus" = 'ACTIVE'
      -- Checked here as well as at publication: a host whose payout account
      -- is later suspended must stop taking bookings immediately.
      AND hp."payoutKycStatus" = 'ACTIVATED'
      AND l."latitude" BETWEEN ${filters.latitude - latDelta} AND ${filters.latitude + latDelta}
      AND l."longitude" BETWEEN ${filters.longitude - lngDelta} AND ${filters.longitude + lngDelta}
      ${listingFilters}
      ${notTaken}
    GROUP BY l."id"
    HAVING ${distance} <= ${filters.radiusKm}
      ${everyDayCovered}
      ${priceCap}
    ORDER BY "distanceKm" ASC
    LIMIT ${CANDIDATE_CAP}
  `);

  if (rows.length === 0) return [];

  // Second pass: opening hours over every day of the stay, and the full price.
  const terms = await prisma.listing.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
    select: {
      id: true,
      ...bookingRuleSelect,
      availability: {
        where: { isActive: true },
        select: { dayOfWeek: true, startMinute: true, endMinute: true },
      },
      pricing: { select: { vehicleType: true, pricePerHour: true, pricePerDay: true } },
    },
  });
  const byId = new Map(terms.map((term) => [term.id, term]));
  const ratings = await reviewService.ratingsFor(rows.map((row) => row.id));

  // Monthly reservations aren't Bookings, so the SQL above can't see them.
  // Hourly: drop spaces a term claims during the stay. Monthly: check the
  // requested term occurrence by occurrence against everything, the same
  // check a reservation will face.
  const ids = rows.map((row) => row.id);
  const unavailable = new Set<string>();
  if (monthly) {
    const startDate = filters.startDate ?? addDays(venueDate(new Date()), 1);
    const term = {
      days: filters.days!,
      startMinute: filters.startMinute ?? 0,
      endMinute: filters.endMinute ?? 1440,
      startDate,
      endDate: addMonths(startDate, filters.months ?? 1),
    };
    for (const id of (await monthlyService.termConflicts(prisma, ids, term)).keys()) unavailable.add(id);
  } else {
    for (const t of await termsTouching(prisma, ids, start, end)) {
      if (termOverlapsRange(t, start, end)) unavailable.add(t.listingId);
    }
  }

  const spots: NearbySpot[] = [];
  for (const row of rows) {
    const term = byId.get(row.id);
    if (!term || unavailable.has(row.id)) continue;

    if (!monthly && !windowsCover(term.availability, start, end)) continue;
    // The host's own rules: an hourly stay's length and how far ahead; a
    // term's start (monthly.service checks the same on reserving).
    if (!monthly && ruleViolation(term, { startsAt: start, minutes })) continue;
    if (monthly && startTooFar(term, startOfVenueDay(filters.startDate ?? venueDate(new Date())))) continue;

    const rates = term.pricing.filter((rate) => !filters.vehicleType || rate.vehicleType === filters.vehicleType);
    const total = monthly ? null : cheapestStay(rates, minutes);
    if (!monthly && total === null) continue;

    const rated = ratings.get(row.id);
    spots.push({
      ...row,
      stayTotal: total ? total.toString() : null,
      rating: rated?.rating ?? null,
      reviewCount: rated?.reviewCount ?? 0,
    });
  }

  if (filters.sort === "price") {
    const key = (spot: NearbySpot) =>
      monthly ? spot.pricePerMonth ?? Infinity : Number(spot.stayTotal ?? spot.pricePerHour);
    spots.sort((a, b) => key(a) - key(b) || a.distanceKm - b.distanceKm);
  }

  return spots.slice(0, limit);
}

/**
 * One spot, as a driver may see it before booking.
 *
 * The gates are the ones the search applies, in the WHERE clause, so "not
 * bookable" and "does not exist" answer identically.
 *
 * `accessInstructions` is deliberately absent: it is the gate code and the
 * guard's name, worth money, and arrives with a paid booking -- as do the
 * street line, the house number, the bay and its marker, and the exact pin
 * (lib/location-privacy). The society, area, entry point ("Main gate, Karve
 * Road") and entry method are public, because a driver needs them to decide.
 * The host is a first name and an initial -- enough to recognise them at the
 * gate, not enough to find them.
 */
export async function getPublic(listingId: string, viewerId: string) {
  const spot = await prisma.listing.findFirst({
    where: { id: listingId, ...BOOKABLE_SPOT },
    select: {
      id: true,
      name: true,
      venueName: true,
      spaceType: true,
      description: true,
      societyName: true,
      area: true,
      city: true,
      state: true,
      pincode: true,
      latitude: true,
      longitude: true,
      amenities: true,
      amenityNote: true,
      vehicleTypes: true,
      maxVehicleHeightCm: true,
      maxVehicleSize: true,
      bayWidthCm: true,
      bayLengthCm: true,
      ...bookingRuleSelect,
      entryPoint: true,
      entryMethod: true,
      rules: true,
      photos: {
        select: { id: true, url: true, position: true },
        orderBy: { position: "asc" },
      },
      pricing: {
        select: { id: true, vehicleType: true, pricePerHour: true, pricePerDay: true, pricePerMonth: true },
      },
      availability: {
        where: { isActive: true },
        select: { id: true, dayOfWeek: true, startMinute: true, endMinute: true, isActive: true },
        orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
      },
      hostProfile: {
        select: { createdAt: true, user: { select: { firstName: true, lastName: true } } },
      },
      favorites: { where: { userId: viewerId }, select: { id: true } },
    },
  });

  if (!spot) {
    throw notFound("Spot not found");
  }

  const { hostProfile, favorites, ...rest } = spot;
  const [rating, reviews] = await Promise.all([
    reviewService.summaryFor(listingId),
    reviewService.recentFor(listingId),
  ]);

  return {
    ...rest,
    latitude: approximate(rest.latitude),
    longitude: approximate(rest.longitude),
    /** The pin is rounded until the driver has paid (lib/location-privacy). */
    locationApproximate: true,
    open24x7:
      new Set(
        spot.availability.filter((w) => w.startMinute === 0 && w.endMinute >= 1440).map((w) => w.dayOfWeek)
      ).size === 7,
    host: {
      displayName: publicName(hostProfile?.user.firstName, hostProfile?.user.lastName, "GatePass host"),
      since: hostProfile?.createdAt.getFullYear() ?? null,
    },
    saved: favorites.length > 0,
    rating,
    /** The newest few; the rest are a page away, at /spots/:id/reviews. */
    reviews,
  };
}

/**
 * What this stay would cost, and whether it can be had -- asked by the
 * checkout before the driver commits. The same price function the booking
 * will charge with, over the same rows, so the quote is the charge.
 */
export async function quote(
  listingId: string,
  input: { vehicleType: string; startsAt: Date; endsAt: Date }
) {
  const spot = await prisma.listing.findFirst({
    where: { id: listingId, ...BOOKABLE_SPOT },
    select: {
      bookingsPausedAt: true,
      ...bookingRuleSelect,
      availability: {
        where: { isActive: true },
        select: { dayOfWeek: true, startMinute: true, endMinute: true },
      },
      pricing: { select: { vehicleType: true, pricePerHour: true, pricePerDay: true } },
    },
  });

  if (!spot) throw notFound("Spot not found");

  const minutes = Math.round((input.endsAt.getTime() - input.startsAt.getTime()) / 60_000);
  if (minutes <= 0) throw badRequest("The stay has to end after it starts");

  const rate = spot.pricing.find((row) => row.vehicleType === input.vehicleType);
  const { platformFee, taxAmount } = driverFees();
  const broken = ruleViolation(spot, { startsAt: input.startsAt, minutes });

  let reason: string | null = null;
  if (spot.bookingsPausedAt) {
    reason = "This space isn't taking new bookings right now.";
  } else if (!rate) {
    reason = "This space doesn't take that vehicle.";
  } else if (!rate.pricePerHour && !rate.pricePerDay) {
    reason = "This space is only rented monthly.";
  } else if (broken) {
    reason = broken;
  } else if (!windowsCover(spot.availability, input.startsAt, input.endsAt)) {
    reason = "The space isn't open for all of those hours.";
  } else {
    const taken = await prisma.booking.findFirst({
      where: {
        listingId,
        startsAt: { lt: input.endsAt },
        endsAt: { gt: input.startsAt },
        OR: [{ status: "CONFIRMED" }, { status: "PENDING", holdExpiresAt: { gt: new Date() } }],
      },
      select: { id: true },
    });
    if (taken) reason = "Those hours have just been booked. Try a different time.";
    else {
      const blocked = await prisma.listingBlock.findFirst({
        where: { listingId, startsAt: { lt: input.endsAt }, endsAt: { gt: input.startsAt } },
        select: { id: true },
      });
      if (blocked) reason = "The host has blocked some of those hours. Try a different time.";
      else if (await termClaiming(prisma, listingId, input.startsAt, input.endsAt)) {
        reason = "This space is reserved monthly for some of those hours. Try a different time.";
      }
    }
  }

  const price = rate ? stayPrice(rate, minutes) : null;
  const parking = price?.amount ?? new Prisma.Decimal(0);

  return {
    available: reason === null,
    reason,
    minutes,
    basis: price?.basis ?? null,
    /** What the stay would cost on the hourly rate alone, to show the saving. */
    hourlyAmount: rate?.pricePerHour ? rate.pricePerHour.mul(minutes).div(60).toDecimalPlaces(2).toString() : null,
    parking: parking.toString(),
    platformFee: platformFee.toString(),
    taxAmount: taxAmount.toString(),
    total: parking.add(platformFee).add(taxAmount).toString(),
  };
}
