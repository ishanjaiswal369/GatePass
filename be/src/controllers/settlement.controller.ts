import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  CreateSettlementInput,
  CreateSettlementItemInput,
  ListSettlementItemsInput,
} from "../requests/settlement.request.js";
import * as settlementService from "../services/settlement.service.js";

export const settlementController = {
  /** The organizer's own statements. */
  list: async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(
      await settlementService.listForOrganizers(request.organizerIds ?? [])
    );
  },

  /** The host's own statements, from the same engine. */
  listForHost: async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(
      await settlementService.listForHost(request.hostProfileId!)
    );
  },

  create: async (
    input: CreateSettlementInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply
      .code(201)
      .send(await settlementService.create(input.body, request.user.userId));
  },

  listItems: async (
    input: ListSettlementItemsInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(
      await settlementService.listItems(input.query.settlementId)
    );
  },

  createItem: async (
    input: CreateSettlementItemInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.code(201).send(await settlementService.createItem(input.body));
  },
};
