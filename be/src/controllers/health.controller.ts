import type { FastifyReply, FastifyRequest } from "fastify";
import { getEmailProvider } from "../integrations/email/index.js";

export const healthController = {
  get: async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      status: "ok",
      timestamp: new Date().toISOString(),
      integrations: { email: getEmailProvider().name },
    });
  },
};
