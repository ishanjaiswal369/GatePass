import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  GetEventInput,
  ListEventsInput,
} from "../requests/event.request.js";
import * as eventService from "../services/event.service.js";

export const eventController = {
  list: async (
    input: ListEventsInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(await eventService.feed(input.query));
  },

  getById: async (
    input: GetEventInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(await eventService.getById(input.params.id));
  },
};
