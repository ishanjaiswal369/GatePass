import { z } from "zod";
import { IntegrationError } from "../integrations/errors.js";
import type { App } from "./app.js";
import { securityEvent } from "./security-log.js";

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode = 400, code = "APP_ERROR") {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class ValidationError extends AppError {
  readonly issues: z.ZodIssue[];

  constructor(issues: z.ZodIssue[]) {
    super("Validation failed", 400, "VALIDATION_ERROR");
    this.name = "ValidationError";
    this.issues = issues;
  }
}

export const badRequest = (message: string) =>
  new AppError(message, 400, "BAD_REQUEST");

export const unauthorized = (message: string) =>
  new AppError(message, 401, "UNAUTHORIZED");

export const forbidden = (message: string) =>
  new AppError(message, 403, "FORBIDDEN");

export const notFound = (message: string) =>
  new AppError(message, 404, "NOT_FOUND");

export const conflict = (message: string) =>
  new AppError(message, 409, "CONFLICT");

export const tooManyRequests = (message: string) =>
  new AppError(message, 429, "TOO_MANY_REQUESTS");

/** A feature the server has not been configured for, not a caller mistake. */
export const serviceUnavailable = (message: string) =>
  new AppError(message, 503, "SERVICE_UNAVAILABLE");

export function registerErrorHandler(app: App): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ValidationError) {
      // Only where the issue is, never the value: a rejected body can hold
      // anything the caller typed.
      securityEvent(request, "VALIDATION_FAILED", {
        fields: error.issues.map((issue) => issue.path.join(".")).slice(0, 10),
      });
      return reply.code(400).send({ errors: error.issues });
    }

    if (error instanceof IntegrationError) {
      request.log.error({ err: error }, "integration call failed");
      return reply.code(502).send({
        error: "Upstream service unavailable",
        capability: error.capability,
        provider: error.provider,
      });
    }

    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        request.log.error({ err: error }, "application error");
      } else if (error.statusCode === 401) {
        securityEvent(request, "AUTH_FAILED", { reason: error.message });
      } else if (error.statusCode === 403) {
        securityEvent(request, "ACCESS_DENIED", { reason: error.message });
      } else if (error.statusCode === 404 && request.user) {
        // A signed-in caller asking for an id that is missing or not theirs.
        // The two answer alike on purpose; a run of these from one user is
        // someone guessing ids.
        securityEvent(request, "NOT_FOUND", { params: request.params });
      } else if (error.statusCode === 429) {
        securityEvent(request, "RATE_LIMITED", { reason: error.message });
      }
      return reply.code(error.statusCode).send({ error: error.message });
    }

    const isClientError =
      error.statusCode !== undefined &&
      error.statusCode >= 400 &&
      error.statusCode < 500;

    if (!isClientError) {
      request.log.error({ err: error }, "unhandled error");
    }

    reply
      .code(isClientError ? error.statusCode! : 500)
      .send({ error: isClientError ? error.message : "Internal server error" });
  });
}
