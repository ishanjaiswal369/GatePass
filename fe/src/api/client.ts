import { Platform } from "react-native";
import type { DeviceType } from "@/constants/enums";
import { getDeviceId } from "@/lib/deviceId";

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

export interface RequestOptions {
  // PUT is here for idempotent upserts -- saving the address is the same
  // request whether or not one exists yet.
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string;
}

/**
 * How long a request may take before it is given up. Longer than the API's
 * own slowest path (a gateway call with its retries), so this only ends
 * requests that have stalled -- which fetch, left alone, never does.
 */
const TIMEOUT_MS = 30_000;

/**
 * The only place fetch is called. Domain modules in this folder build on it;
 * screens never call it directly.
 *
 * Every failure leaves here as an ApiError: no connection and a stalled
 * request as status 0, an answer that isn't the API's JSON (a proxy's error
 * page) under its own status.
 */
export async function request<T>(
  path: string,
  { method = "GET", body, token }: RequestOptions = {}
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  let text: string;

  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    text = await response.text();
  } catch {
    throw new ApiError(
      controller.signal.aborted
        ? "That took too long. Check your connection and try again."
        : `Cannot reach the API at ${API_URL}`,
      0
    );
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(`Unexpected answer from the server (${response.status})`, response.ok ? 502 : response.status);
    }
  }

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

/**
 * Device fields every auth call sends. Async because the installation id lives
 * in the platform's real store -- see lib/deviceId.
 */
export async function deviceFields(): Promise<{
  deviceId: string;
  deviceType: DeviceType;
}> {
  return { deviceId: await getDeviceId(), deviceType };
}
