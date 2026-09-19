import type {
  ChangePasswordResult,
  MeResult,
  SessionRow,
  VerifyCodeResult,
} from "@/types/api.types";
import { deviceFields, deviceName, request } from "./client";

/**
 * Signup sends firstName/lastName; sign-in omits them. The API parks the name
 * on the verification row until the code is confirmed, so an unverified email
 * never creates a user.
 */
export const requestCode = async (input: {
  email: string;
  firstName?: string;
  lastName?: string;
}) =>
  request<{ message: string; code?: string }>("/auth/request-code", {
    method: "POST",
    body: { ...input, ...(await deviceFields()) },
  });

export const verifyCode = async (input: { email: string; code: string }) =>
  request<VerifyCodeResult>("/auth/verify-code", {
    method: "POST",
    body: { ...input, ...(await deviceFields()), deviceName },
  });

/**
 * Only the token crosses the wire. The API reads the email and name out of its
 * verified payload -- anything this client claimed about itself is ignored.
 */
export const signInWithGoogle = async (idToken: string) =>
  request<VerifyCodeResult>("/auth/google", {
    method: "POST",
    body: { idToken, ...(await deviceFields()), deviceName },
  });

export const getMe = (token: string) => request<MeResult>("/auth/me", { token });

export const updateProfile = (
  token: string,
  input: { firstName?: string; lastName?: string | null }
) => request<MeResult>("/auth/me", { method: "PATCH", body: input, token });

export const listSessions = (token: string) =>
  request<{ sessions: SessionRow[] }>("/auth/sessions", { token });

export const revokeSession = (token: string, sessionId: string) =>
  request<{ message: string }>(`/auth/sessions/${sessionId}`, {
    method: "DELETE",
    token,
  });

export const logout = (token: string) =>
  request<{ message: string }>("/auth/logout", { method: "POST", token });

/**
 * Mails a code for setting a password. Used by both entry points -- the
 * profile screen and forgot-password -- so it takes no token. The response is
 * identical for a registered and an unknown address by design.
 */
export const requestPasswordCode = async (email: string) =>
  request<{ message: string; code?: string }>("/auth/password/request-code", {
    method: "POST",
    body: { email, ...(await deviceFields()) },
  });

/** Returns a fresh session: every earlier one is revoked server-side. */
export const setPassword = async (input: {
  email: string;
  code: string;
  password: string;
}) =>
  request<VerifyCodeResult>("/auth/password/set", {
    method: "POST",
    body: { ...input, ...(await deviceFields()), deviceName },
  });

export const loginWithPassword = async (input: {
  email: string;
  password: string;
}) =>
  request<VerifyCodeResult>("/auth/login", {
    method: "POST",
    body: { ...input, ...(await deviceFields()), deviceName },
  });

/**
 * Changes a known password. The caller's own session survives, so the token
 * in hand keeps working; every other device is signed out.
 */
export const changePassword = (
  token: string,
  input: { currentPassword: string; newPassword: string }
) =>
  request<ChangePasswordResult>("/auth/password/change", {
    method: "POST",
    body: input,
    token,
  });
