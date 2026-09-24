import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  BookingPassInput,
  CancelBookingInput,
  CancellationInput,
  CreateExtensionInput,
  ExtensionOptionsInput,
  CreateBookingInput,
  CreateSpotBookingInput,
  GetBookingInput,
  ListBookingsInput,
} from "../requests/booking.request.js";
import * as cancellationService from "../services/booking-cancellation.service.js";
import * as extensionService from "../services/booking-extension.service.js";
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

  createSpot: async (
    input: CreateSpotBookingInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const { booking, replayed } = await bookingService.createSpotBooking(
      input.body,
      request.user.userId
    );

    return reply.code(replayed ? 200 : 201).send(booking);
  },

  /** What cancelling now would give back, before the driver commits to it. */
  cancellation: async (input: CancellationInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await cancellationService.quote(input.params.id, request.user.userId));
  },

  cancel: async (input: CancelBookingInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(
      await cancellationService.cancel(input.params.id, request.user.userId, input.body.reason)
    );
  },

  extensionOptions: async (input: ExtensionOptionsInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await extensionService.options(input.params.id, request.user.userId));
  },

  createExtension: async (input: CreateExtensionInput, request: FastifyRequest, reply: FastifyReply) => {
    const result = await extensionService.create(input.params.id, request.user.userId, input.body);
    return reply.code(201).send(result);
  },
};
