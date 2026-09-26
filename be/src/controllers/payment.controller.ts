import type { FastifyReply, FastifyRequest } from "fastify";
import * as paymentService from "../services/payment.service.js";

export const paymentController = {
  list: async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await paymentService.listForDriver(request.user.userId));
  },
};
