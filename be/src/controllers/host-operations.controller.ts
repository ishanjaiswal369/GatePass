import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  HostBookingsInput,
  HostCalendarInput,
  HostCreateBlockInput,
  HostOverviewInput,
  HostPauseInput,
  HostRemoveBlockInput,
} from "../requests/host-operations.request.js";
import * as hostOps from "../services/host-operations.service.js";

/** Set by requireHost; every handler here runs behind it. */
function hostProfileId(request: FastifyRequest): string {
  if (!request.hostProfileId) throw new Error("requireHost must run before this handler");
  return request.hostProfileId;
}

export const hostOperationsController = {
  summary: async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await hostOps.summary(hostProfileId(request)));
  },

  overview: async (input: HostOverviewInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await hostOps.overview(input.params.id, hostProfileId(request)));
  },

  pause: async (input: HostPauseInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await hostOps.setPaused(input.params.id, hostProfileId(request), request.user.userId, input.body.paused));
  },

  bookings: async (input: HostBookingsInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await hostOps.listBookings(hostProfileId(request), input.query));
  },

  calendar: async (input: HostCalendarInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await hostOps.calendar(input.params.id, hostProfileId(request), input.query.from, input.query.days));
  },

  createBlock: async (input: HostCreateBlockInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(201).send(await hostOps.createBlocks(input.params.id, hostProfileId(request), request.user.userId, input.body));
  },

  removeBlock: async (input: HostRemoveBlockInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await hostOps.removeBlock(input.params.id, input.params.blockId, hostProfileId(request), request.user.userId));
  },

  earnings: async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await hostOps.earnings(hostProfileId(request)));
  },
};
