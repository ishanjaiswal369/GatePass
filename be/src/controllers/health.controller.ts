import type { FastifyReply, FastifyRequest } from "fastify";
import { getEmailProvider } from "../integrations/email/index.js";
import { BUILD_STAMP } from "../lib/build.js";
import { routeCount } from "../lib/routes.js";

export const healthController = {
  get: async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      status: "ok",
      timestamp: new Date().toISOString(),
      // `build` and `routes` are here to answer one question quickly: is this
      // server actually running the code I just wrote? A container started
      // without --build reports an old stamp and a lower route count, which
      // is otherwise indistinguishable from a broken frontend.
      build: BUILD_STAMP,
      routes: routeCount(),
      integrations: { email: getEmailProvider().name },
    });
  },
};
