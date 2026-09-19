import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  CreateCapacityInput,
  ListCapacitiesInput,
} from "../requests/capacity.request.js";
import * as capacityService from "../services/capacity.service.js";

function organizerIds(request: FastifyRequest): string[] {
  if (!request.organizerIds) {
    throw new Error("requireOrganizerStaff must run before this handler");
  }

  return request.organizerIds;
}

export const capacityController = {
  list: async (
    input: ListCapacitiesInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(
      await capacityService.list(organizerIds(request), input.query.listingId)
    );
  },

  create: async (
    input: CreateCapacityInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply
      .code(201)
      .send(await capacityService.create(input.body, organizerIds(request)));
  },
};
