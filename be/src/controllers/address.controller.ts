import type { FastifyReply, FastifyRequest } from "fastify";
import type { SaveAddressInput } from "../requests/address.request.js";
import * as addressService from "../services/address.service.js";

export const addressController = {
  /** 200 with `address: null` -- not having one yet is the normal state. */
  get: async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ address: await addressService.get(request.user.userId) });
  },

  save: async (
    input: SaveAddressInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send({
      address: await addressService.save(request.user.userId, input.body),
    });
  },
};
