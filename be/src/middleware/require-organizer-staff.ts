import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../lib/prisma.js";

/**
 * Gates the organizer endpoints. Runs after `authenticate`.
 *
 * Membership is read from OrganizerMember, not from User.role, so that adding
 * someone to an organizer takes effect on their next request instead of on
 * their next login.
 */
export async function requireOrganizerStaff(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const memberships = await prisma.organizerMember.findMany({
    where: { userId: request.user.userId },
    select: { organizerId: true },
  });

  if (memberships.length === 0) {
    return reply.code(403).send({
      error: "Organizer access required",
      code: "ORGANIZER_ACCESS_REQUIRED",
    });
  }

  request.organizerIds = memberships.map((row) => row.organizerId);
}
