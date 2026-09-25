import { FastifyRequest, FastifyReply } from "fastify";
import { securityEvent } from "../lib/security-log.js";
import { getUserFromToken } from "../services/session.service.js";

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    securityEvent(request, "AUTH_FAILED", { reason: "missing_token" });
    return reply.code(401).send({ error: "Missing or invalid Authorization header" });
  }

  const token = authHeader.substring(7);

  const user = await getUserFromToken(token);

  if (!user) {
    securityEvent(request, "AUTH_FAILED", { reason: "invalid_or_expired_token" });
    return reply.code(401).send({ error: "Invalid or expired token" });
  }

  request.user = user;
}
