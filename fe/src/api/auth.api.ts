import type {
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
export const requestCode = (input: {
  email: string;
  firstName?: string;
  lastName?: string;
}) =>
  request<{ message: string; code?: string }>("/auth/request-code", {
    method: "POST",
    body: { ...input, ...deviceFields },
  });

export const verifyCode = (input: { email: string; code: string }) =>
  request<VerifyCodeResult>("/auth/verify-code", {
    method: "POST",
    body: { ...input, ...deviceFields, deviceName },
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
