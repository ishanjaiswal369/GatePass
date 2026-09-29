import type { FastifyReply, FastifyRequest } from "fastify";
import type { UpdateSettingsInput } from "../requests/settings.request.js";
import * as settingsService from "../services/settings.service.js";

export const settingsController = {
  get: async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await settingsService.getSettings(request.user.userId));
  },

  update: async (input: UpdateSettingsInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await settingsService.updateSettings(request.user.userId, input.body));
  },
};
