import { z } from "zod";
import { MAX_PAGE_SIZE } from "../lib/pagination.js";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

const listEventsQuery = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    // Capped so one request cannot ask for a box covering the country and
    // turn the prefilter into a full scan.
    radiusKm: z.coerce.number().positive().max(100).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).optional(),
  })
  .refine(
    (value) =>
      (value.latitude === undefined) === (value.longitude === undefined),
    {
      path: ["longitude"],
      message: "latitude and longitude must be given together",
    }
  );

const eventIdParams = z.object({
  id: z.string().uuid(),
});

export const eventRequests = {
  list: { query: listEventsQuery } satisfies RequestSchemas,
  getById: { params: eventIdParams } satisfies RequestSchemas,
};

export type ListEventsInput = RequestInput<typeof eventRequests.list>;
export type GetEventInput = RequestInput<typeof eventRequests.getById>;
