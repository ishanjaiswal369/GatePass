import type { FastifyReply, FastifyRequest } from "fastify";
import { notFound } from "../lib/errors.js";
import type {
  GoogleSignInInput,
  RemoveSessionInput,
  RequestCodeInput,
  UpdateProfileInput,
  VerifyCodeInput,
  RequestPasswordCodeInput,
  SetPasswordInput,
  LoginInput,
  ChangePasswordInput,
  RequestDeletionCodeInput,
  DeleteAccountInput,
} from "../requests/auth.request.js";
import * as accountService from "../services/account.service.js";
import * as authService from "../services/auth.service.js";
import * as sessionService from "../services/session.service.js";
import * as userService from "../services/user.service.js";

/**
 * The /auth/me shape, shared by GET and PATCH so both always agree. Vehicles
 * and address are eager-loaded in the same query as the user -- the profile
 * screen shows all three, and fetching them separately cost two extra round
 * trips on every visit.
 */
async function meResponse(userId: string) {
  const user = await userService.getProfile(userId);

  if (!user) {
    throw notFound("User not found");
  }

  const { vehicles, address, hostProfile } = user;
  const { savedCount, liveSpaces } = await userService.profileCounts(userId, hostProfile !== null);

  return {
    ...userService.toAuthUser(user),
    profileComplete: user.firstName !== null,
    hasHostProfile: hostProfile !== null,
    vehicles,
    address,
    savedCount,
    liveSpaces,
  };
}

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

  requestPasswordCode: async (
    input: RequestPasswordCodeInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const result = await authService.requestPasswordCode(input.body);
    // Same answer for a registered and an unknown address, so the response
    // cannot be used to enumerate accounts.
    return reply.send({ message: "If that email has an account, a code is on its way", ...result });
  },

  setPassword: async (
    input: SetPasswordInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(await authService.setPassword(input.body));
  },

  login: async (
    input: LoginInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(await authService.loginWithPassword(input.body));
  },

  changePassword: async (
    input: ChangePasswordInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(
      await authService.changePassword({
        userId: request.user.userId,
        sessionId: request.user.sessionId,
        ...input.body,
      })
    );
  },

  me: async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await meResponse(request.user.userId));
  },

  updateMe: async (
    input: UpdateProfileInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    await userService.updateProfile(request.user.userId, input.body);
    return reply.send(await meResponse(request.user.userId));
  },

  /** What would stop a deletion now, so the screen can say so up front. */
  deletionStatus: async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      blockers: await accountService.deletionBlockers(request.user.userId),
    });
  },

  requestDeletionCode: async (
    input: RequestDeletionCodeInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const { code } = await accountService.requestDeletionCode(
      request.user.userId,
      input.body
    );
    return reply.send({ message: "Confirmation code sent", code });
  },

  deleteAccount: async (
    input: DeleteAccountInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    await accountService.deleteAccount(request.user.userId, input.body.code);
    return reply.code(204).send();
  },
};
