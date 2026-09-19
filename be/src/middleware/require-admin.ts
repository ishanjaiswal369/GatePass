import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../lib/prisma.js";

/**
 * Gates the operations that move money on someone else's behalf. Runs after
 * `authenticate`.
 *
 * Reads the role from the database rather than from the JWT claim: a token
 * minted before a demotion would keep admin rights for the rest of its 30 day
 * life. The claim in the token is for display, this is for access.
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const user = await prisma.user.findUnique({
    where: { id: request.user.userId },
    select: { role: true },
  });

  if (user?.role !== "ADMIN") {
    return reply
      .code(403)
      .send({ error: "Admin access required", code: "ADMIN_ACCESS_REQUIRED" });
  }
}
