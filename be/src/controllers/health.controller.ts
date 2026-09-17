import type { FastifyReply, FastifyRequest } from "fastify";
import { getSmsProvider } from "../integrations/sms/index.js";

export const healthController = {
  get: async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      status: "ok",
      timestamp: new Date().toISOString(),
      integrations: { sms: getSmsProvider().name },
    });
  },
};
