import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  BookingPassInput,
  CreateBookingInput,
  GetBookingInput,
  ListBookingsInput,
} from "../requests/booking.request.js";
import * as bookingService from "../services/booking.service.js";

export const bookingController = {
  list: async (
    input: ListBookingsInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const page = await bookingService.listForDriver(request.user.userId, {
      scope: input.query.scope,
      cursor: input.query.cursor,
      limit: input.query.limit,
    });

    return reply.send(page);
  },

  active: async (request: FastifyRequest, reply: FastifyReply) => {
    const booking = await bookingService.getActiveForDriver(
      request.user.userId
    );

    // 200 with null rather than 404: "you have no active pass" is the normal
    // state of the home screen, not an error the app should branch on.
    return reply.send({ booking });
  },

  getById: async (
    input: GetBookingInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(
      await bookingService.getForDriver(input.params.id, request.user.userId)
    );
  },

  pass: async (
    input: BookingPassInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(
      await bookingService.issuePassForDriver(
        input.params.id,
        request.user.userId
      )
    );
  },

  create: async (
    input: CreateBookingInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const { booking, replayed } = await bookingService.create(
      input.body,
      request.user.userId
    );

    // A replay is not a creation, so it does not answer 201.
    return reply.code(replayed ? 200 : 201).send(booking);
  },
};
