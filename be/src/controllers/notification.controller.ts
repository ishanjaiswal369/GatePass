import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  ListNotificationsInput,
  PushTokenInput,
  ReadNotificationsInput,
} from "../requests/notification.request.js";
import * as notificationService from "../services/notification.service.js";
import { clearPushToken, savePushToken } from "../services/push-dispatch.service.js";

export const notificationController = {
  list: async (input: ListNotificationsInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await notificationService.list(request.user.userId, input.query));
  },

  unreadCount: async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ unread: await notificationService.unreadCount(request.user.userId) });
  },

  read: async (input: ReadNotificationsInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await notificationService.markRead(request.user.userId, input.body.ids));
  },

  /** For this device: the session comes from the token, so a caller can only set their own. */
  savePushToken: async (input: PushTokenInput, request: FastifyRequest, reply: FastifyReply) => {
    await savePushToken(request.user.userId, request.user.sessionId, input.body.token);
    return reply.code(204).send();
  },

  clearPushToken: async (request: FastifyRequest, reply: FastifyReply) => {
    await clearPushToken(request.user.userId, request.user.sessionId);
    return reply.code(204).send();
  },
};
