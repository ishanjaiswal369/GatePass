import type { FastifyReply, FastifyRequest } from "fastify";
import { getGeocodeProvider } from "../integrations/geocode/index.js";
import { notFound } from "../lib/errors.js";
import type {
  GeocodePlaceInput,
  GeocodeSearchInput,
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
};
