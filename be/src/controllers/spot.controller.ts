import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  GetSpotInput,
  NearbySpotsInput,
} from "../requests/spot.request.js";
import * as spotService from "../services/spot.service.js";

export const spotController = {
  nearby: async (
    input: NearbySpotsInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send({ spots: await spotService.nearby(input.query) });
  },

  getById: async (
    input: GetSpotInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(await spotService.getPublic(input.params.id));
  },
};
