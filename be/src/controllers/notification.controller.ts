import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  ListNotificationsInput,
  NotificationPreferencesInput,
  ReadNotificationsInput,
} from "../requests/notification.request.js";
import * as notificationService from "../services/notification.service.js";

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

  getPreferences: async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await notificationService.getPreferences(request.user.userId));
  },

  updatePreferences: async (input: NotificationPreferencesInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await notificationService.updatePreferences(request.user.userId, input.body));
  },
};
