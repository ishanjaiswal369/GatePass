import type { FastifyReply, FastifyRequest } from "fastify";
import { notFound } from "../lib/errors.js";
import type {
  RemoveSessionInput,
  RequestOtpInput,
  VerifyOtpInput,
} from "../requests/auth.request.js";
import * as authService from "../services/auth.service.js";
import * as sessionService from "../services/session.service.js";
import * as userService from "../services/user.service.js";

export const authController = {
  requestOtp: async (
    input: RequestOtpInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const { otp } = await authService.requestOtp(input.body);
    return reply.send({ message: "OTP sent successfully", otp });
  },

  verifyOtp: async (
    input: VerifyOtpInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(await authService.verifyOtp(input.body));
  },

  logout: async (request: FastifyRequest, reply: FastifyReply) => {
    await sessionService.revokeSession(request.user.sessionId);
    return reply.send({ message: "Logged out successfully" });
  },

  listSessions: async (request: FastifyRequest, reply: FastifyReply) => {
    const sessions = await sessionService.getUserSessions(request.user.userId);

    return reply.send({
      sessions: sessions.map((session) => ({
        id: session.id,
        deviceId: session.deviceId,
        deviceType: session.deviceType,
        deviceName: session.deviceName,
        lastActiveAt: session.lastActiveAt,
        createdAt: session.createdAt,
        current: session.id === request.user.sessionId,
      })),
    });
  },

  removeSession: async (
    input: RemoveSessionInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    await sessionService.removeSession(
      input.params.sessionId,
      request.user.userId,
      request.user.sessionId
    );

    return reply.send({ message: "Session removed successfully" });
  },

  me: async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await userService.getById(request.user.userId);

    if (!user) {
      throw notFound("User not found");
    }

    return reply.send({
      id: user.id,
      email: user.email,
      phone: user.phone,
      name: user.name,
      role: user.role,
    });
  },
};
