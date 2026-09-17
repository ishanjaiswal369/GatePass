import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  CreateSettlementInput,
  CreateSettlementItemInput,
} from "../requests/settlement.request.js";
import * as settlementService from "../services/settlement.service.js";

export const settlementController = {
  list: async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await settlementService.list());
  },

  create: async (
    input: CreateSettlementInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.code(201).send(await settlementService.create(input.body));
  },

  listItems: async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await settlementService.listItems());
  },

  createItem: async (
    input: CreateSettlementItemInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.code(201).send(await settlementService.createItem(input.body));
  },
};
