import { Platform } from "react-native";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";

export type DeviceType = "IOS" | "ANDROID" | "WEB" | "OTHER";

export interface AuthUser {
  id: string;
  email: string;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string;
}

export interface VerifyResult {
  token: string;
  user: AuthUser;
  profileComplete: boolean;
}

export interface MeResult extends AuthUser {
  profileComplete: boolean;
}

export interface SessionRow {
  id: string;
  deviceId: string;
  deviceType: string;
  deviceName: string | null;
  lastActiveAt: string;
  createdAt: string;
  current: boolean;
}

/**
 * Carries the HTTP status so screens can tell a rate limit (429) apart from a
 * wrong code (400) -- the backend distinguishes them and the UI should too.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const deviceType: DeviceType =
  Platform.OS === "ios" ? "IOS" : Platform.OS === "android" ? "ANDROID" : "WEB";

/**
 * Stable per browser/app install so repeat logins reuse one UserSession row
 * rather than piling up. Falls back to per-load when there is no localStorage
 * (native, private mode), which is fine for testing.
 */
export const deviceId = (() => {
  const fresh = `dev-${Math.random().toString(36).slice(2, 10)}`;
  try {
    const store = (globalThis as { localStorage?: Storage }).localStorage;
    if (!store) return fresh;
    const saved = store.getItem("gatepass.deviceId");
    if (saved) return saved;
    store.setItem("gatepass.deviceId", fresh);
    return fresh;
  } catch {
    return fresh;
  }
})();

async function call<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {}
): Promise<T> {
  const { method = "GET", body, token } = options;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(`Cannot reach the API at ${API_URL}`, 0);
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    // The API returns { error } for AppError and { errors: [...] } for zod.
    const message =
      data?.error ??
      data?.errors?.map((i: { message: string }) => i.message).join(", ") ??
      `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }

  return data as T;
}

export const healthCheck = () =>
  call<{ status: string; integrations: { email: string } }>("/health");

export const requestCode = (input: {
  email: string;
  firstName?: string;
  lastName?: string;
}) =>
  call<{ message: string; code?: string }>("/auth/request-code", {
    method: "POST",
    body: { ...input, deviceId, deviceType },
  });

export const verifyCode = (input: { email: string; code: string }) =>
  call<VerifyResult>("/auth/verify-code", {
    method: "POST",
    body: {
      ...input,
      deviceId,
      deviceType,
      deviceName: Platform.OS === "web" ? "Browser" : Platform.OS,
    },
  });

export const getMe = (token: string) =>
  call<MeResult>("/auth/me", { token });

export const updateMe = (
  token: string,
  input: { firstName?: string; lastName?: string | null }
) => call<MeResult>("/auth/me", { method: "PATCH", body: input, token });

export const listSessions = (token: string) =>
  call<{ sessions: SessionRow[] }>("/auth/sessions", { token });

export const logout = (token: string) =>
  call<{ message: string }>("/auth/logout", { method: "POST", token });
