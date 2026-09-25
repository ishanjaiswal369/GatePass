import { z } from "zod";
import { AMENITIES, SPACE_TYPES, VEHICLE_SIZES, VEHICLE_TYPES } from "../constants/enums/index.js";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

const MINUTES_IN_DAY = 24 * 60;

/**
 * "0,1,5" -> [0, 1, 5]. Present means a recurring (monthly) search.
 *
 * Parsed rather than taken as a repeated param so the whole search stays one
 * readable query string, which is what the results screen is bookmarked and
 * shared as.
 */
const dayList = z
  .string()
  .transform((value) => value.split(",").map(Number))
  .refine(
    (days) =>
      days.length > 0 &&
      days.length <= 7 &&
      days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) &&
      new Set(days).size === days.length,
    { message: "must be distinct weekday numbers, 0-6" }
  );

/** "CCTV,COVERED" -> ["CCTV", "COVERED"], every value checked against its enum. */
function csvOf<T extends string>(values: readonly T[]) {
  return z
    .string()
    .transform((value) => value.split(",").filter(Boolean))
    .refine((items) => items.every((item) => (values as readonly string[]).includes(item)), {
      message: `must be a comma-separated list of ${values.join(", ")}`,
    })
    .transform((items) => [...new Set(items)] as T[]);
}

/** The longest single stay the hourly/daily search answers. Longer is monthly. */
const MAX_STAY_MINUTES = 30 * MINUTES_IN_DAY;

const nearbyQuery = z
  .object({
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
    radiusKm: z.coerce.number().positive().max(25).default(5),
    at: z.coerce.date().optional(),
    // Up to 30 days: the app lets a driver book that long, so the search has
    // to be able to ask about it (it stopped at one day before).
    durationMinutes: z.coerce.number().int().positive().max(MAX_STAY_MINUTES).default(60),
    vehicleType: z.enum(VEHICLE_TYPES).optional(),
    /** The driver's car size; spaces that only fit a smaller car are left out. */
    vehicleSize: z.enum(VEHICLE_SIZES).optional(),
    limit: z.coerce.number().int().positive().max(50).optional(),
    days: dayList.optional(),
    /** Monthly only: the term, so every occurrence -- not just the first week -- is checked. */
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD").optional(),
    months: z.coerce.number().int().refine((m) => [1, 3, 6, 12].includes(m), "must be 1, 3, 6 or 12").optional(),
    startMinute: z.coerce.number().int().min(0).max(MINUTES_IN_DAY).optional(),
    endMinute: z.coerce.number().int().min(0).max(MINUTES_IN_DAY).optional(),
    amenities: csvOf(AMENITIES).optional(),
    spaceTypes: csvOf(SPACE_TYPES).optional(),
    maxPricePerHour: z.coerce.number().positive().max(10_000).optional(),
    open24x7: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
    /** Average stars at least this. An unrated spot has no average, so it is left out. */
    minRating: z.coerce.number().min(1).max(5).optional(),
    sort: z.enum(["distance", "price"]).default("distance"),
  })
  .refine(
    (value) =>
      value.days === undefined ||
      (value.startMinute !== undefined &&
        value.endMinute !== undefined &&
        value.startMinute < value.endMinute),
    {
      path: ["endMinute"],
      // Without the hours, "these weekdays" would match a spot open for ten
      // minutes on each of them.
      message: "a recurring search needs startMinute and endMinute",
    }
  );

const spotIdParams = z.object({ id: z.string().uuid() });

const quoteQuery = z
  .object({
    vehicleType: z.enum(VEHICLE_TYPES),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .refine((value) => value.endsAt.getTime() - value.startsAt.getTime() >= 15 * 60_000, {
    path: ["endsAt"],
    message: "minimum stay is 15 minutes",
  })
  .refine((value) => value.endsAt.getTime() - value.startsAt.getTime() <= MAX_STAY_MINUTES * 60_000, {
    path: ["endsAt"],
    message: "that stay is too long to book here",
  });

export const spotRequests = {
  nearby: { query: nearbyQuery } satisfies RequestSchemas,
  getById: { params: spotIdParams } satisfies RequestSchemas,
  quote: { params: spotIdParams, query: quoteQuery } satisfies RequestSchemas,
  favorite: { params: spotIdParams } satisfies RequestSchemas,
};

export type NearbySpotsInput = RequestInput<typeof spotRequests.nearby>;
export type GetSpotInput = RequestInput<typeof spotRequests.getById>;
export type QuoteSpotInput = RequestInput<typeof spotRequests.quote>;
export type FavoriteSpotInput = RequestInput<typeof spotRequests.favorite>;
