import type { FastifyReply, FastifyRequest } from "fastify";
import { notFound } from "../lib/errors.js";
import type {
  GoogleSignInInput,
  RemoveSessionInput,
  RequestCodeInput,
  UpdateProfileInput,
  VerifyCodeInput,
} from "../requests/auth.request.js";
import * as authService from "../services/auth.service.js";
import * as sessionService from "../services/session.service.js";
import * as userService from "../services/user.service.js";

export const authController = {
  requestCode: async (
    input: RequestCodeInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const { code } = await authService.requestCode(input.body);
    return reply.send({ message: "Verification code sent", code });
  },

  verifyCode: async (
    input: VerifyCodeInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(await authService.verifyCode(input.body));
  },

  googleSignIn: async (
    input: GoogleSignInInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(await authService.signInWithGoogle(input.body));
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
      ...userService.toAuthUser(user),
      profileComplete: user.firstName !== null,
    });
  },

  updateMe: async (
    input: UpdateProfileInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const user = await userService.updateProfile(
      request.user.userId,
      input.body
    );

    return reply.send({
      ...userService.toAuthUser(user),
      profileComplete: user.firstName !== null,
    });
  },
};
