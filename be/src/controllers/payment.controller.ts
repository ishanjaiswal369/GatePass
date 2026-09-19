import type { FastifyReply, FastifyRequest } from "fastify";
import type { CreatePaymentInput } from "../requests/payment.request.js";
import * as paymentService from "../services/payment.service.js";

export const paymentController = {
  list: async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await paymentService.listForDriver(request.user.userId));
  },

  create: async (
    input: CreatePaymentInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply
      .code(201)
      .send(await paymentService.create(input.body, request.user.userId));
  },
};
