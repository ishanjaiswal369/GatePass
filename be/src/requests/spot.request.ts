import { z } from "zod";
import { AMENITIES, SPACE_TYPES, VEHICLE_SIZES, VEHICLE_TYPES } from "../constants/enums/index.js";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

const MINUTES_IN_DAY = 24 * 60;

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

/** The longest single stay a search, quote or booking answers. */
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
    amenities: csvOf(AMENITIES).optional(),
    spaceTypes: csvOf(SPACE_TYPES).optional(),
    maxPricePerHour: z.coerce.number().positive().max(10_000).optional(),
    open24x7: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
    /** Average stars at least this. An unrated spot has no average, so it is left out. */
    minRating: z.coerce.number().min(1).max(5).optional(),
    sort: z.enum(["distance", "price"]).default("distance"),
  });

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
