import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../lib/prisma.js";

/**
 * Gates the host endpoints. Runs after `authenticate`.
 *
 * The check reads HostProfile every time rather than trusting a claim in the
 * JWT. A token minted before onboarding would say "not a host" for its full 30
 * day life, and one minted before a suspension would say "host" just as long.
 * A row lookup is the only answer that is true right now.
 */
export async function requireHost(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const profile = await prisma.hostProfile.findUnique({
    where: { userId: request.user.userId },
    select: { id: true, verificationStatus: true },
  });

  if (!profile) {
    return reply
      .code(403)
      .send({ error: "Host profile required", code: "HOST_PROFILE_REQUIRED" });
  }

  if (profile.verificationStatus !== "ACTIVE") {
    return reply.code(403).send({
      error: "Host profile is not active",
      code: "HOST_PROFILE_INACTIVE",
    });
  }

  request.hostProfileId = profile.id;
}
