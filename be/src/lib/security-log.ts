import type { FastifyRequest } from "fastify";
import { app } from "./app.js";

/**
 * The two kinds of line the API writes on purpose.
 *
 * - `securityEvent` (warn): someone was refused -- a bad or missing token, a
 *   rate limit, a resource that isn't theirs. One of these is noise; a burst
 *   from one caller is an attack, which is why each carries the caller.
 * - `audit` (info): something changed that money or trust depends on -- a
 *   booking made or cancelled, a review posted, a report filed, a host
 *   blocking hours.
 *
 * Ids only. Never a token, a code, a password, an email or free text a user
 * typed: logs are kept longer and read by more people than the database.
 */

export type SecurityEventName =
  | "AUTH_FAILED"
  | "ACCESS_DENIED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "VALIDATION_FAILED";

export function securityEvent(
  request: FastifyRequest,
  event: SecurityEventName,
  details: Record<string, unknown> = {}
): void {
  request.log.warn(
    {
      security: event,
      userId: request.user?.userId ?? null,
      ip: request.ip,
      method: request.method,
      route: request.routeOptions?.url ?? request.url,
      ...details,
    },
    `security: ${event}`
  );
}

export function audit(event: string, details: Record<string, unknown>): void {
  app.log.info({ audit: event, ...details }, `audit: ${event}`);
}
