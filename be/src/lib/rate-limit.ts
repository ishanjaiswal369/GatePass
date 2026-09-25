import rateLimit from "@fastify/rate-limit";
import type { FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import type { App } from "./app.js";
import { tooManyRequests } from "./errors.js";

/**
 * Requests per minute, per caller, in three buckets.
 *
 * - `auth`: the unauthenticated sign-in and password routes, per IP. The
 *   per-email code limits in auth.service still apply on top; this one stops
 *   a single machine walking through many emails.
 * - `write`: anything that changes state, per user (per IP when signed out).
 * - `read`: everything else.
 *
 * The caller is the user id from a token that verifies -- checked here with
 * the signature only, no database -- so rotating junk tokens does not buy a
 * fresh bucket: an unverifiable token counts against the IP. /health and the
 * signed upload URLs are exempt: one is polled, the other is already bounded
 * by its signature and expiry.
 */

const AUTH_ROUTES = new Set([
  "/auth/request-code",
  "/auth/verify-code",
  "/auth/google",
  "/auth/login",
  "/auth/password/request-code",
  "/auth/password/set",
]);

type Bucket = "auth" | "write" | "read";

function bucketOf(request: FastifyRequest): Bucket {
  const path = request.url.split("?")[0];
  if (request.method === "POST" && AUTH_ROUTES.has(path)) return "auth";
  return request.method === "GET" || request.method === "HEAD" ? "read" : "write";
}

function callerOf(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(header.slice(7), env.JWT_SECRET) as { userId?: string };
      if (payload.userId) return `user:${payload.userId}`;
    } catch {
      // Falls through to the IP.
    }
  }
  return `ip:${request.ip}`;
}

const LIMITS: Record<Bucket, number> = {
  auth: env.RATE_LIMIT_AUTH_PER_MIN,
  write: env.RATE_LIMIT_WRITE_PER_MIN,
  read: env.RATE_LIMIT_READ_PER_MIN,
};

export async function registerRateLimit(app: App): Promise<void> {
  if (!env.RATE_LIMIT_ENABLED) return;

  await app.register(rateLimit, {
    global: true,
    timeWindow: 60_000,
    keyGenerator: (request) => {
      const bucket = bucketOf(request);
      // Sign-in is always per IP: there is no user yet.
      return bucket === "auth" ? `auth:ip:${request.ip}` : `${bucket}:${callerOf(request)}`;
    },
    max: (request) => LIMITS[bucketOf(request)],
    allowList: (request) => request.url === "/health" || request.url.startsWith("/uploads/"),
    // Thrown as an AppError so the error handler answers it like every other
    // 429 -- `{ error }` -- and logs it once, as RATE_LIMITED.
    errorResponseBuilder: (_request, context) =>
      tooManyRequests(`Too many requests. Try again in ${Math.ceil(context.ttl / 1000)}s.`),
  });
}
