import type { FastifyReply, FastifyRequest } from "fastify";
import type { CreateBookingInput } from "../requests/booking.request.js";
import * as bookingService from "../services/booking.service.js";

export const bookingController = {
  list: async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await bookingService.list());
  },

  create: async (
    input: CreateBookingInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.code(201).send(await bookingService.create(input.body));
  },
};
