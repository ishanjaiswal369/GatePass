import { z } from "zod";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

const geocodeQuery = z
  .object({
    q: z.string().trim().min(3).max(200),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    /**
     * Groups a burst of keystrokes and the details call that follows into one
     * billed session. Opaque to us: it is minted by the client and only has to
     * be stable for the life of one search.
     */
    sessionToken: z.string().trim().min(1).max(100).optional(),
  })
  .refine(
    (value) =>
      (value.latitude === undefined) === (value.longitude === undefined),
    {
      path: ["longitude"],
      message: "latitude and longitude must be given together",
    }
  );

const placeParams = z.object({
  placeId: z.string().trim().min(1).max(300),
});

const placeQuery = z.object({
  sessionToken: z.string().trim().min(1).max(100).optional(),
});

export const geocodeRequests = {
  search: { query: geocodeQuery } satisfies RequestSchemas,
  autocomplete: { query: geocodeQuery } satisfies RequestSchemas,
  place: { params: placeParams, query: placeQuery } satisfies RequestSchemas,
};

export type GeocodeSearchInput = RequestInput<typeof geocodeRequests.search>;
export type GeocodePlaceInput = RequestInput<typeof geocodeRequests.place>;
