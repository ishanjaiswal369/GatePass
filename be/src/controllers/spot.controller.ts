import type { FastifyReply, FastifyRequest } from "fastify";
import type { NearbySpotsInput } from "../requests/spot.request.js";
import * as spotService from "../services/spot.service.js";

export const spotController = {
  nearby: async (
    input: NearbySpotsInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send({ spots: await spotService.nearby(input.query) });
  },
};
