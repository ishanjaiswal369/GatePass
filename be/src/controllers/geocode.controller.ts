import type { FastifyReply, FastifyRequest } from "fastify";
import { getGeocodeProvider } from "../integrations/geocode/index.js";
import type { GeocodeSearchInput } from "../requests/geocode.request.js";

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
};
