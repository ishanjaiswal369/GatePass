import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  CreateListingInput,
  ListListingsInput,
} from "../requests/listing.request.js";
import * as listingService from "../services/listing.service.js";

export const listingController = {
  list: async (
    input: ListListingsInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(await listingService.list(input.query.organizerId));
  },

  create: async (
    input: CreateListingInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const listing = await listingService.create(input.body, request.user.userId);
    return reply.code(201).send(listing);
  },
};
