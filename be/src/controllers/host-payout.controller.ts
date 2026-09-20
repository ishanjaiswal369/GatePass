import type { FastifyReply, FastifyRequest } from "fastify";
import type { SubmitPayoutInput } from "../requests/host-payout.request.js";
import * as hostPayoutService from "../services/host-payout.service.js";

function hostProfileId(request: FastifyRequest): string {
  if (!request.hostProfileId) {
    throw new Error("requireHost must run before this handler");
  }

  return request.hostProfileId;
}

export const hostPayoutController = {
  getStatus: async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await hostPayoutService.getStatus(hostProfileId(request)));
  },

  submit: async (
    input: SubmitPayoutInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply
      .code(201)
      .send(
        await hostPayoutService.submit(hostProfileId(request), input.body)
      );
  },
};
