import { Prisma } from "@prisma/client";
import { notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

const KM_PER_LAT_DEGREE = 111.045;

/**
 * Every venue and every host in this product is in one country, so a window
 * stored as "18:00 on a Tuesday" means 18:00 IST. Hard-coding it is honest for
 * a single-market app and cheaper than a per-listing timezone column that
 * would be the same value on every row; it becomes wrong the day the product
 * crosses a timezone, which is the point to revisit it.
 */
const VENUE_TIME_ZONE = "Asia/Kolkata";

export interface NearbyFilters {
  latitude: number;
  longitude: number;
  radiusKm: number;
  /** When the driver needs the spot. Defaults to now. */
  at?: Date;
  /** How long for, in minutes. Used to require the window covers the stay. */
  durationMinutes?: number;
  /** Only spots priced for this vehicle. Absent means any, at its best rate. */
  vehicleType?: string;
  limit?: number;
  /**
   * A recurring search instead of a one-off stay: these weekdays, between
   * these minutes, every week. Present means monthly.
   *
   * A spot qualifies only if it is open across the whole range on *every* one
   * of these days -- a driveway free on Mondays is no use to somebody who
   * needs it all week, and offering it would waste the trip rather than
   * nearly work.
   */
  days?: number[];
  startMinute?: number;
  endMinute?: number;
}

export interface NearbySpot {
  id: string;
  name: string;
  venueName: string;
  city: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  pricePerHour: number;
  availableUntilMinute: number;
}

/**
 * Local day-of-week and minute-of-day for an instant.
 *
 * Derived through Intl rather than the server's own clock: a container running
 * in UTC would otherwise report Monday 22:30 as the wrong day entirely for
 * anything after 18:30 IST, which silently hides every evening window.
 */
function localDayAndMinute(at: Date): { dayOfWeek: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: VENUE_TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);

  const lookup = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  // Intl can return "24" for midnight with hour12: false.
  const hour = Number(lookup("hour")) % 24;

  return {
    dayOfWeek: Math.max(days.indexOf(lookup("weekday")), 0),
    minute: hour * 60 + Number(lookup("minute")),
  };
}

/**
 * Host spots bookable around a point at a given time.
 *
 * Ordered by distance and capped, with no cursor: a radius search is a short,
 * position-dependent list, and a cursor over a distance that changes as the
 * driver walks would be a cursor over a moving target. Narrowing the radius is
 * the way to refine it.
 */
export async function nearby(filters: NearbyFilters): Promise<NearbySpot[]> {
  const at = filters.at ?? new Date();
  const limit = filters.limit ?? 20;
  const { dayOfWeek, minute } = localDayAndMinute(at);
  const endMinute = minute + (filters.durationMinutes ?? 60);

  const monthly = filters.days !== undefined && filters.days.length > 0;

  /**
   * The availability join is the filter, in both modes: a listing with no
   * window covering what was asked for simply produces no rows.
   *
   * Monthly differs only in matching a set of weekdays at a fixed time of day
   * rather than one weekday at one instant. The "on every day" part cannot
   * live here -- a join can only say "at least one" -- so it is the HAVING
   * below that counts the distinct days back.
   */
  const availabilityJoin = monthly
    ? Prisma.sql`
        AND ha."dayOfWeek" = ANY(${filters.days}::int[])
        AND ha."startMinute" <= ${filters.startMinute ?? 0}
        AND ha."endMinute" >= ${filters.endMinute ?? 1440}
      `
    : Prisma.sql`
        AND ha."dayOfWeek" = ${dayOfWeek}
        AND ha."startMinute" <= ${minute}
        AND ha."endMinute" >= ${endMinute}
      `;

  const everyDayCovered = monthly
    ? Prisma.sql`AND COUNT(DISTINCT ha."dayOfWeek") = ${filters.days!.length}`
    : Prisma.empty;

  const latDelta = filters.radiusKm / KM_PER_LAT_DEGREE;
  const lngDelta =
    filters.radiusKm /
    (KM_PER_LAT_DEGREE *
      Math.max(Math.cos((filters.latitude * Math.PI) / 180), 0.01));

  const vehicleTypeFilter = filters.vehicleType
    ? Prisma.sql`AND sp."vehicleType" = ${filters.vehicleType}`
    : Prisma.empty;

  const distance = Prisma.sql`
    6371 * acos(LEAST(1, GREATEST(-1,
      sin(radians(${filters.latitude}::float8)) * sin(radians(l."latitude"::float8))
      + cos(radians(${filters.latitude}::float8)) * cos(radians(l."latitude"::float8))
        * cos(radians(l."longitude"::float8) - radians(${filters.longitude}::float8))
    )))
  `;

  return prisma.$queryRaw<NearbySpot[]>(Prisma.sql`
    SELECT
      l."id",
      l."name",
      l."venueName",
      l."city",
      l."latitude"::float8 AS "latitude",
      l."longitude"::float8 AS "longitude",
      ${distance} AS "distanceKm",
      MIN(sp."pricePerHour")::float8 AS "pricePerHour",
      MAX(ha."endMinute")::int AS "availableUntilMinute"
    FROM "Listing" l
    JOIN "HostProfile" hp ON hp."id" = l."hostProfileId"
    -- The join itself is the availability filter: a listing with no active
    -- window covering the requested time simply produces no rows. Scoped to
    -- the listing, not the host -- a host with several spots schedules each
    -- one separately.
    JOIN "HostAvailability" ha
      ON ha."listingId" = l."id"
     AND ha."isActive" = true
     ${availabilityJoin}
    -- Also a filter, not just a lookup: a spot with no rate for the vehicle
    -- the driver is in cannot be booked, so it should not be shown.
    JOIN "SpotPricing" sp
      ON sp."listingId" = l."id"
     ${vehicleTypeFilter}
    WHERE l."listingType" = 'INDEPENDENT_SPOT'
      AND l."status" = 'PUBLISHED'
      AND hp."verificationStatus" = 'ACTIVE'
      -- Checked here as well as at publication time. A host whose payout
      -- account is later suspended must stop taking bookings immediately;
      -- relying on the status column alone would keep selling a spot whose
      -- host can no longer be paid.
      AND hp."payoutKycStatus" = 'ACTIVATED'
      AND l."latitude" BETWEEN ${filters.latitude - latDelta} AND ${filters.latitude + latDelta}
      AND l."longitude" BETWEEN ${filters.longitude - lngDelta} AND ${filters.longitude + lngDelta}
    GROUP BY l."id"
    HAVING ${distance} <= ${filters.radiusKm}
      ${everyDayCovered}
    ORDER BY "distanceKm" ASC
    LIMIT ${limit}
  `);
}

/**
 * One spot, as a driver may see it before booking.
 *
 * The gates are the same three the search applies -- published, host
 * verified, payout active -- and they are in the WHERE clause rather than
 * checked after the read, so "not bookable" and "does not exist" answer
 * identically. A listing id that leaked from somewhere should not confirm
 * that a suspended spot is real.
 *
 * `accessInstructions` is deliberately absent. It is the gate code and the
 * guard's name, and it is worth money: anyone who could read it here would
 * have no reason to book. It arrives with the booking, once paid.
 */
export async function getPublic(listingId: string) {
  const spot = await prisma.listing.findFirst({
    where: {
      id: listingId,
      listingType: "INDEPENDENT_SPOT",
      status: { in: ["PUBLISHED", "ONGOING"] },
      hostProfile: {
        verificationStatus: "ACTIVE",
        payoutKycStatus: "ACTIVATED",
      },
    },
    select: {
      id: true,
      name: true,
      venueName: true,
      spaceType: true,
      addressLine: true,
      city: true,
      state: true,
      pincode: true,
      latitude: true,
      longitude: true,
      photos: {
        select: { id: true, url: true, position: true },
        orderBy: { position: "asc" },
      },
      pricing: { select: { id: true, vehicleType: true, pricePerHour: true } },
      availability: {
        where: { isActive: true },
        select: {
          id: true,
          dayOfWeek: true,
          startMinute: true,
          endMinute: true,
          isActive: true,
        },
        orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
      },
    },
  });

  if (!spot) {
    throw notFound("Spot not found");
  }

  return spot;
}
