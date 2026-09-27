import type { FastifyReply, FastifyRequest } from "fastify";
import type { SubmitPayoutInput } from "../requests/host-payout.request.js";
import * as hostPayoutService from "../services/host-payout.service.js";

/**
 * The signed-in user's payout account. Not behind requireHost: payouts are
 * their own tab and can be set up before anything is listed, so the user is
 * the key and the service finds (or, on submit, creates) their host profile.
 */
export const hostPayoutController = {
  getStatus: async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await hostPayoutService.getStatusForUser(request.user.userId));
  },

  submit: async (
    input: SubmitPayoutInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply
      .code(201)
      .send(await hostPayoutService.submitForUser(request.user.userId, input.body));
  },
};
