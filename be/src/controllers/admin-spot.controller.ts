import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  AdminOwnershipDocumentInput,
  ApproveSpotInput,
  GetSpotInput,
  ListSpotsInput,
  RejectSpotInput,
  SetPayoutStatusInput,
  SuspendSpotInput,
} from "../requests/admin-spot.request.js";
import { sendFile } from "../lib/send-file.js";
import { audit } from "../lib/security-log.js";
import * as adminSpotService from "../services/admin-spot.service.js";
import * as spotListingService from "../services/spot-listing.service.js";
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
        input.body.reason,
        input.body.section
      )
    );
  },

  /** The ownership document, for the reviewer. Streamed here because its public URL is closed. */
  ownershipDocument: async (input: AdminOwnershipDocumentInput, request: FastifyRequest, reply: FastifyReply) => {
    const file = await spotListingService.ownershipDocumentFile(input.params.id, null);
    audit("OWNERSHIP_DOC_VIEWED", { userId: request.user.userId, listingId: input.params.id, as: "admin" });
    return sendFile(reply, file);
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
