import type { SessionPayload } from "../services/session.service.js";

declare module "fastify" {
  interface FastifyRequest {
    user: SessionPayload;
  }
}
