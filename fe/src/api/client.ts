import { Platform } from "react-native";
import type { DeviceType } from "@/constants/enums";

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";

/**
 * Carries the HTTP status so callers can tell a rate limit (429) apart from a
 * wrong code (400). The API distinguishes them; the UI should too.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  get isOffline(): boolean {
    return this.status === 0;
  }
}

export const deviceType: DeviceType =
  Platform.OS === "ios" ? "IOS" : Platform.OS === "android" ? "ANDROID" : "WEB";

export const deviceName = Platform.OS === "web" ? "Browser" : Platform.OS;

/**
 * Stable per install so repeat logins reuse one UserSession row instead of
 * piling up. Falls back to per-load where there is no localStorage.
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

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string;
}

/**
 * The only place fetch is called. Domain modules in this folder build on it;
 * screens never call it directly.
 */
export async function request<T>(
  path: string,
  { method = "GET", body, token }: RequestOptions = {}
): Promise<T> {
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
      data?.errors?.map((issue: { message: string }) => issue.message).join(", ") ??
      `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }

  return data as T;
}

/** Device fields every auth call sends. */
export const deviceFields = { deviceId, deviceType };
