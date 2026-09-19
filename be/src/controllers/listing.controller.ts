import type { FastifyReply, FastifyRequest } from "fastify";
import type { CreateListingInput } from "../requests/listing.request.js";
import * as listingService from "../services/listing.service.js";

/**
 * Routes behind requireOrganizerStaff always have organizerIds set; the
 * middleware answers 403 before the handler runs.
 */
function organizerIds(request: FastifyRequest): string[] {
  if (!request.organizerIds) {
    throw new Error("requireOrganizerStaff must run before this handler");
  }

  return request.organizerIds;
}

export const listingController = {
  list: async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await listingService.list(organizerIds(request)));
  },

  create: async (
    input: CreateListingInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const listing = await listingService.create(
      input.body,
      organizerIds(request),
      request.user.userId
    );

    return reply.code(201).send(listing);
  },
};
