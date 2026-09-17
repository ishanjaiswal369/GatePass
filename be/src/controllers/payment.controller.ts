import type { FastifyReply, FastifyRequest } from "fastify";
import type { CreatePaymentInput } from "../requests/payment.request.js";
import * as paymentService from "../services/payment.service.js";

export const paymentController = {
  list: async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await paymentService.list());
  },

  create: async (
    input: CreatePaymentInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.code(201).send(await paymentService.create(input.body));
  },
};
