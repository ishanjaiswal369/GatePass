import { z } from "zod";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

const nearbyQuery = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().positive().max(25).default(5),
  at: z.coerce.date().optional(),
  durationMinutes: z.coerce.number().int().positive().max(1440).default(60),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

export const spotRequests = {
  nearby: { query: nearbyQuery } satisfies RequestSchemas,
};

export type NearbySpotsInput = RequestInput<typeof spotRequests.nearby>;
