import type { FastifyReply, FastifyRequest } from "fastify";
import type { AdminListRefundsInput, RetryRefundInput } from "../requests/refund.request.js";
import * as refundService from "../services/refund.service.js";

export const refundController = {
  adminList: async (input: AdminListRefundsInput, _request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ refunds: await refundService.listForAdmin(input.query.status) });
  },

  retry: async (input: RetryRefundInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await refundService.retryFailedRefund(input.params.id, request.user.userId));
  },
};
