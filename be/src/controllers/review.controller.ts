import type { FastifyReply, FastifyRequest } from "fastify";
import type { CreateReviewInput, ListSpotReviewsInput } from "../requests/review.request.js";
import * as reviewService from "../services/review.service.js";

export const reviewController = {
  create: async (input: CreateReviewInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(201).send(await reviewService.create(input.params.id, request.user.userId, input.body));
  },

  listForSpot: async (input: ListSpotReviewsInput, _request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await reviewService.listForSpot(input.params.id, input.query));
  },
};
