import { z } from "zod";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

const geocodeQuery = z
  .object({
    q: z.string().trim().min(3).max(200),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
  })
  .refine(
    (value) =>
      (value.latitude === undefined) === (value.longitude === undefined),
    {
      path: ["longitude"],
      message: "latitude and longitude must be given together",
    }
  );

export const geocodeRequests = {
  search: { query: geocodeQuery } satisfies RequestSchemas,
};

export type GeocodeSearchInput = RequestInput<typeof geocodeRequests.search>;
