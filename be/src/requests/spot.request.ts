import { z } from "zod";
import { VEHICLE_TYPES } from "../constants/enums/index.js";
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

const nearbyQuery = z
  .object({
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
    radiusKm: z.coerce.number().positive().max(25).default(5),
    at: z.coerce.date().optional(),
    durationMinutes: z.coerce.number().int().positive().max(1440).default(60),
    vehicleType: z.enum(VEHICLE_TYPES).optional(),
    limit: z.coerce.number().int().positive().max(50).optional(),
    days: dayList.optional(),
    startMinute: z.coerce.number().int().min(0).max(MINUTES_IN_DAY).optional(),
    endMinute: z.coerce.number().int().min(0).max(MINUTES_IN_DAY).optional(),
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

export const spotRequests = {
  nearby: { query: nearbyQuery } satisfies RequestSchemas,
  getById: { params: z.object({ id: z.string().uuid() }) } satisfies RequestSchemas,
};

export type NearbySpotsInput = RequestInput<typeof spotRequests.nearby>;
export type GetSpotInput = RequestInput<typeof spotRequests.getById>;
