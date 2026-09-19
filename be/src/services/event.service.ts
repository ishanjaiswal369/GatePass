import { Prisma } from "@prisma/client";
import { notFound } from "../lib/errors.js";
import {
  DEFAULT_PAGE_SIZE,
  type Page,
  decodeCursor,
  encodeCursor,
} from "../lib/pagination.js";
import { prisma } from "../lib/prisma.js";

/** Listing states a driver is allowed to see. DRAFT is never one of them. */
const VISIBLE_STATUSES = ["PUBLISHED", "ONGOING"];

/** An event stays in the feed this long after it starts. */
const FEED_GRACE_MS = 6 * 60 * 60 * 1000;

/** Degrees of latitude per kilometre; good to a fraction of a percent. */
const KM_PER_LAT_DEGREE = 111.045;

export interface EventFeedFilters {
  q?: string;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit?: number;
}

export interface EventFeedItem {
  id: string;
  name: string;
  venueName: string;
  eventDate: Date;
  latitude: number | null;
  longitude: number | null;
  minPrice: number;
  spotsLeft: number;
  vehicleTypes: string[];
  distanceKm: number | null;
}

/**
 * Great-circle distance in kilometres, or NULL when the caller gave no
 * position. Clamped before acos because floating point can push the cosine a
 * hair past 1 for two points at the same coordinates, which makes acos return
 * NaN and the row vanish.
 */
function distanceExpression(
  latitude?: number,
  longitude?: number
): Prisma.Sql {
  if (latitude === undefined || longitude === undefined) {
    return Prisma.sql`NULL::float8`;
  }

  return Prisma.sql`
    6371 * acos(LEAST(1, GREATEST(-1,
      sin(radians(${latitude}::float8)) * sin(radians(l."latitude"::float8))
      + cos(radians(${latitude}::float8)) * cos(radians(l."latitude"::float8))
        * cos(radians(l."longitude"::float8) - radians(${longitude}::float8))
    )))
  `;
}

/**
 * Bounding box around the search point.
 *
 * This is a prefilter, not the answer: it runs against the plain B-tree on
 * (latitude, longitude) and cuts the candidate set to a square, and the
 * haversine distance above then trims the square to a circle. Doing it the
 * other way round -- computing distance for every listing -- means a full scan
 * on every home screen load.
 */
function boundingBox(
  latitude: number,
  longitude: number,
  radiusKm: number
): Prisma.Sql {
  const latDelta = radiusKm / KM_PER_LAT_DEGREE;
  // Lines of longitude converge towards the poles, so a kilometre is worth
  // more degrees the further from the equator you are.
  const lngDelta =
    radiusKm /
    (KM_PER_LAT_DEGREE * Math.max(Math.cos((latitude * Math.PI) / 180), 0.01));

  return Prisma.sql`
    AND l."latitude" BETWEEN ${latitude - latDelta} AND ${latitude + latDelta}
    AND l."longitude" BETWEEN ${longitude - lngDelta} AND ${longitude + lngDelta}
  `;
}

export async function feed(
  filters: EventFeedFilters
): Promise<Page<EventFeedItem>> {
  const limit = filters.limit ?? DEFAULT_PAGE_SIZE;
  const from = filters.from ?? new Date(Date.now() - FEED_GRACE_MS);

  const hasPosition =
    filters.latitude !== undefined && filters.longitude !== undefined;

  const searchClause = filters.q
    ? Prisma.sql`AND (l."name" ILIKE ${`%${filters.q}%`} OR l."venueName" ILIKE ${`%${filters.q}%`})`
    : Prisma.empty;

  const toClause = filters.to
    ? Prisma.sql`AND l."eventDate" <= ${filters.to}`
    : Prisma.empty;

  const boxClause =
    hasPosition && filters.radiusKm
      ? boundingBox(filters.latitude!, filters.longitude!, filters.radiusKm)
      : Prisma.empty;

  // Keyset pagination on the same (eventDate, id) pair the rows are ordered
  // by. The row comparison is a single index-friendly predicate, unlike the
  // OR-chain people usually hand-write for this.
  const cursorClause = filters.cursor
    ? (() => {
        const [eventDate, id] = decodeCursor(filters.cursor!, 2);
        return Prisma.sql`AND (l."eventDate", l."id") > (${new Date(eventDate)}, ${id})`;
      })()
    : Prisma.empty;

  const radiusClause =
    hasPosition && filters.radiusKm
      ? Prisma.sql`HAVING ${distanceExpression(filters.latitude, filters.longitude)} <= ${filters.radiusKm}`
      : Prisma.empty;

  const rows = await prisma.$queryRaw<
    (Omit<EventFeedItem, "minPrice" | "spotsLeft" | "distanceKm"> & {
      minPrice: number;
      spotsLeft: number;
      distanceKm: number | null;
    })[]
  >(Prisma.sql`
    SELECT
      l."id",
      l."name",
      l."venueName",
      l."eventDate",
      l."latitude"::float8 AS "latitude",
      l."longitude"::float8 AS "longitude",
      MIN(pc."price")::float8 AS "minPrice",
      -- GREATEST guards the sum against a capacity row that was oversold
      -- before the atomic update landed, or reduced after bookings existed.
      COALESCE(SUM(GREATEST(pc."totalCapacity" - pc."bookedCount", 0)), 0)::int AS "spotsLeft",
      ARRAY_AGG(DISTINCT pc."vehicleType") AS "vehicleTypes",
      ${distanceExpression(filters.latitude, filters.longitude)} AS "distanceKm"
    FROM "Listing" l
    -- INNER JOIN on purpose: a listing with no capacity rows cannot be
    -- booked, so it has no business being in a booking feed.
    JOIN "ParkingCapacity" pc ON pc."listingId" = l."id"
    WHERE l."status" = ANY(${VISIBLE_STATUSES})
      AND l."listingType" <> 'INDEPENDENT_SPOT'
      -- The card renders a day and a month, so an undated listing has nothing
      -- to show and is excluded rather than rendered blank.
      AND l."eventDate" IS NOT NULL
      AND l."eventDate" >= ${from}
      ${toClause}
      ${searchClause}
      ${boxClause}
      ${cursorClause}
    GROUP BY l."id"
    ${radiusClause}
    ORDER BY l."eventDate" ASC, l."id" ASC
    LIMIT ${limit + 1}
  `);

  const items = rows.slice(0, limit);
  const last = items.at(-1);

  return {
    items,
    nextCursor:
      rows.length > limit && last
        ? encodeCursor([last.eventDate.toISOString(), last.id])
        : null,
  };
}

/**
 * One event with its bookable capacity rows. Organizer identity is reduced to
 * a name: the driver needs to know whose event it is, not who to email.
 */
export async function getById(id: string) {
  const listing = await prisma.listing.findFirst({
    where: {
      id,
      status: { in: VISIBLE_STATUSES },
      listingType: { not: "INDEPENDENT_SPOT" },
    },
    select: {
      id: true,
      name: true,
      venueName: true,
      eventDate: true,
      latitude: true,
      longitude: true,
      listingType: true,
      status: true,
      organizer: { select: { name: true } },
      capacities: {
        select: {
          id: true,
          vehicleType: true,
          gate: true,
          price: true,
          totalCapacity: true,
          bookedCount: true,
        },
        orderBy: { vehicleType: "asc" },
      },
    },
  });

  if (!listing) {
    throw notFound("Event not found");
  }

  const { capacities, ...rest } = listing;

  return {
    ...rest,
    capacities: capacities.map(({ totalCapacity, bookedCount, ...capacity }) => ({
      ...capacity,
      // bookedCount is an internal counter; the driver needs what is left.
      spotsLeft: Math.max(totalCapacity - bookedCount, 0),
    })),
  };
}
