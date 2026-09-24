import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  FavoriteSpotInput,
  GetSpotInput,
  NearbySpotsInput,
  QuoteSpotInput,
} from "../requests/spot.request.js";
import * as favoriteService from "../services/favorite.service.js";
import * as spotService from "../services/spot.service.js";

export const spotController = {
  nearby: async (input: NearbySpotsInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ spots: await spotService.nearby(input.query, request.user.userId) });
  },

  getById: async (input: GetSpotInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await spotService.getPublic(input.params.id, request.user.userId));
  },

  quote: async (input: QuoteSpotInput, _request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await spotService.quote(input.params.id, input.query));
  },

  favorites: async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ spots: await favoriteService.list(request.user.userId) });
  },

  save: async (input: FavoriteSpotInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await favoriteService.save(request.user.userId, input.params.id));
  },

  unsave: async (input: FavoriteSpotInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await favoriteService.unsave(request.user.userId, input.params.id));
  },
};
