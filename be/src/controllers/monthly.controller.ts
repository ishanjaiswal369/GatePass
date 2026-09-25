import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  CancelMonthlyInput,
  CreateMonthlyInput,
  GetMonthlyInput,
  ListMonthlyInput,
  MonthlyQuoteInput,
} from "../requests/monthly.request.js";
import * as monthlyService from "../services/monthly.service.js";

export const monthlyController = {
  quote: async (input: MonthlyQuoteInput, _request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await monthlyService.quote(input.params.id, input.query));
  },

  create: async (input: CreateMonthlyInput, request: FastifyRequest, reply: FastifyReply) => {
    const result = await monthlyService.create(request.user.userId, input.body);
    return reply.code(result.replayed ? 200 : 201).send(result);
  },

  list: async (input: ListMonthlyInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await monthlyService.listForDriver(request.user.userId, input.query.scope));
  },

  get: async (input: GetMonthlyInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await monthlyService.getForDriver(input.params.id, request.user.userId));
  },

  cancellation: async (input: GetMonthlyInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await monthlyService.cancellationQuote(input.params.id, request.user.userId));
  },

  cancel: async (input: CancelMonthlyInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await monthlyService.cancel(input.params.id, request.user.userId, input.body.reason));
  },
};
