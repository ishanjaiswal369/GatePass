import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  ApproveSpotInput,
  GetSpotInput,
  ListSpotsInput,
  RejectSpotInput,
  SetPayoutStatusInput,
  SuspendSpotInput,
} from "../requests/admin-spot.request.js";
import * as adminSpotService from "../services/admin-spot.service.js";
import * as hostPayoutService from "../services/host-payout.service.js";

export const adminSpotController = {
  list: async (
    input: ListSpotsInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send({
      spots: await adminSpotService.listForReview(input.query.status),
    });
  },

  getById: async (
    input: GetSpotInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(await adminSpotService.getForReview(input.params.id));
  },

  approve: async (
    input: ApproveSpotInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(
      await adminSpotService.approve(input.params.id, request.user.userId)
    );
  },

  reject: async (
    input: RejectSpotInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(
      await adminSpotService.reject(
        input.params.id,
        request.user.userId,
        input.body.reason
      )
    );
  },

  suspend: async (
    input: SuspendSpotInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(
      await adminSpotService.suspend(
        input.params.id,
        request.user.userId,
        input.body.reason
      )
    );
  },

  /**
   * The manual stand-in for the gateway's webhook. Whoever verified the bank
   * details by hand records the outcome here, and a listing that was only
   * waiting on this goes live as a result.
   */
  setPayoutStatus: async (
    input: SetPayoutStatusInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(
      await hostPayoutService.setStatus(
        input.body.hostProfileId,
        input.body.status,
        input.body.payoutAccountId
      )
    );
  },
};
