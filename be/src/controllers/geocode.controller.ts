import type { FastifyReply, FastifyRequest } from "fastify";
import { getGeocodeProvider } from "../integrations/geocode/index.js";
import { http } from "../integrations/http.js";
import { IntegrationError } from "../integrations/errors.js";
import { notFound, serviceUnavailable } from "../lib/errors.js";
import type {
  GeocodePlaceInput,
  GeocodeSearchInput,
  StaticMapInput,
} from "../requests/geocode.request.js";

export const geocodeController = {
  search: async (
    input: GeocodeSearchInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const provider = getGeocodeProvider();
    const { q, latitude, longitude } = input.query;

    const results = await provider.search(
      q,
      latitude !== undefined && longitude !== undefined
        ? { latitude, longitude }
        : undefined
    );

    return reply.send({ results, provider: provider.name });
  },

  /**
   * Type-ahead suggestions.
   *
   * A provider without an autocomplete of its own falls back to search(),
   * which costs more per keystroke but returns the same shape -- with
   * coordinates already filled in, so the client skips the details call.
   * That keeps one client path for every provider.
   */
  autocomplete: async (
    input: GeocodeSearchInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const provider = getGeocodeProvider();
    const { q, latitude, longitude, sessionToken } = input.query;
    const near =
      latitude !== undefined && longitude !== undefined
        ? { latitude, longitude }
        : undefined;

    const suggestions = provider.autocomplete
      ? await provider.autocomplete(q, near, sessionToken)
      : await provider.search(q, near);

    return reply.send({ suggestions, provider: provider.name });
  },

  /** Coordinates for a suggestion the host picked. */
  place: async (
    input: GeocodePlaceInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const provider = getGeocodeProvider();

    if (!provider.placeDetails) {
      // Only reachable if a client asks for details against a provider whose
      // suggestions already carried coordinates, which means it did not need
      // to ask.
      throw notFound("This provider resolves places during search");
    }

    const result = await provider.placeDetails(
      input.params.placeId,
      input.query.sessionToken
    );

    if (!result) {
      throw notFound("Place not found");
    }

    return reply.send({ result, provider: provider.name });
  },

  /**
   * A flat map image, fetched here rather than by the app.
   *
   * The upstream URL carries the API key, so handing it to the client would
   * hand over the key -- the same reason place search is proxied. The bytes
   * are small and cacheable, which is what makes the extra hop affordable.
   */
  staticMap: async (
    input: StaticMapInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const provider = getGeocodeProvider();

    if (!provider.staticMapUrl) {
      throw serviceUnavailable("This provider has no map images");
    }

    const { latitude, longitude, zoom, width, height, scale, mapType } =
      input.query;
    const url = provider.staticMapUrl({
      latitude,
      longitude,
      zoom,
      width,
      height,
      scale,
      mapType,
    });

    try {
      const upstream = await http.get<ArrayBuffer>(url, {
        responseType: "arraybuffer",
      });

      return reply
        .type(String(upstream.headers["content-type"] ?? "image/png"))
        // The same square is requested again on every re-render and every
        // revisit; without this each one is another billed image.
        .header("Cache-Control", "private, max-age=86400")
        .send(Buffer.from(upstream.data));
    } catch (error) {
      throw IntegrationError.from(
        { capability: "geocode", provider: provider.name, operation: "staticMap" },
        error
      );
    }
  },
};
