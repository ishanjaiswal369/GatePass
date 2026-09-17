import type { FastifyReply, FastifyRequest } from "fastify";
import type { CreateCapacityInput } from "../requests/capacity.request.js";
import * as capacityService from "../services/capacity.service.js";

export const capacityController = {
  list: async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await capacityService.list());
  },

  create: async (
    input: CreateCapacityInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.code(201).send(await capacityService.create(input.body));
  },
};
