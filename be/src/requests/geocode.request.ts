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

/** A point to name. No session token: this is not part of a search session. */
const reverseQuery = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});

const staticMapQuery = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  // 21 is Google's deepest. 11 frames a whole search area (~15 km) for the
  // results map; the pin picker asks for 16+, where a driveway is visible.
  zoom: z.coerce.number().int().min(11).max(21).default(18),
  // Bounded because the caller picks them and each pixel is billed upstream.
  width: z.coerce.number().int().min(100).max(640).default(400),
  height: z.coerce.number().int().min(100).max(640).default(260),
  scale: z.coerce.number().int().refine((v) => v === 1 || v === 2).default(2),
  mapType: z.enum(["roadmap", "satellite", "hybrid"]).default("roadmap"),
});

export const geocodeRequests = {
  search: { query: geocodeQuery } satisfies RequestSchemas,
  autocomplete: { query: geocodeQuery } satisfies RequestSchemas,
  place: { params: placeParams, query: placeQuery } satisfies RequestSchemas,
  reverse: { query: reverseQuery } satisfies RequestSchemas,
  staticMap: { query: staticMapQuery } satisfies RequestSchemas,
};

export type GeocodeSearchInput = RequestInput<typeof geocodeRequests.search>;
export type GeocodePlaceInput = RequestInput<typeof geocodeRequests.place>;
export type GeocodeReverseInput = RequestInput<typeof geocodeRequests.reverse>;
export type StaticMapInput = RequestInput<typeof geocodeRequests.staticMap>;
