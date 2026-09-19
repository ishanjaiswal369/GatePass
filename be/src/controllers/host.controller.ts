import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  AddAvailabilityInput,
  CreateHostProfileInput,
  RemoveAvailabilityInput,
  UpdateAvailabilityInput,
} from "../requests/host.request.js";
import * as hostService from "../services/host.service.js";

/**
 * Routes behind requireHost always have hostProfileId set. The middleware
 * answers 403 before the handler runs, so this only narrows the type.
 */
function hostProfileId(request: FastifyRequest): string {
  if (!request.hostProfileId) {
    throw new Error("requireHost must run before this handler");
  }

  return request.hostProfileId;
}

export const hostController = {
  /**
   * Answers 200 with `profile: null` for a user who has not onboarded, rather
   * than 404. The app calls this to decide which screen the Host tab opens,
   * and "no profile yet" is the expected answer for most users.
   */
  getProfile: async (request: FastifyRequest, reply: FastifyReply) => {
    const profile = await hostService.getByUserId(request.user.userId);
    return reply.send({ profile });
  },

  createProfile: async (
    input: CreateHostProfileInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const profile = await hostService.createProfile(
      request.user.userId,
      input.body
    );

    return reply.code(201).send({ profile });
  },

  listAvailability: async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      availability: await hostService.listAvailability(hostProfileId(request)),
    });
  },

  addAvailability: async (
    input: AddAvailabilityInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply
      .code(201)
      .send(await hostService.addAvailability(hostProfileId(request), input.body));
  },

  updateAvailability: async (
    input: UpdateAvailabilityInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(
      await hostService.updateAvailability(
        input.params.id,
        hostProfileId(request),
        input.body
      )
    );
  },

  removeAvailability: async (
    input: RemoveAvailabilityInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    await hostService.removeAvailability(input.params.id, hostProfileId(request));
    return reply.code(204).send();
  },
};
