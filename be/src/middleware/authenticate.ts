import { FastifyRequest, FastifyReply } from "fastify";
import { getUserFromToken } from "../services/session.service.js";

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "Missing or invalid Authorization header" });
  }

  const token = authHeader.substring(7);

  const user = await getUserFromToken(token);

  if (!user) {
    return reply.code(401).send({ error: "Invalid or expired token" });
  }

  request.user = user;
}
