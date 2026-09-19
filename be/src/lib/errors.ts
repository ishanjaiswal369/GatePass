import { z } from "zod";
import { IntegrationError } from "../integrations/errors.js";
import type { App } from "./app.js";

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
      return reply.code(400).send({ errors: error.issues });
    }

    if (error instanceof IntegrationError) {
      console.error("integration call failed", error);
      return reply.code(502).send({
        error: "Upstream service unavailable",
        capability: error.capability,
        provider: error.provider,
      });
    }

    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        console.error("application error", error);
      }
      return reply.code(error.statusCode).send({ error: error.message });
    }

    const isClientError =
      error.statusCode !== undefined &&
      error.statusCode >= 400 &&
      error.statusCode < 500;

    if (!isClientError) {
      console.error("unhandled error", error);
    }

    reply
      .code(isClientError ? error.statusCode! : 500)
      .send({ error: isClientError ? error.message : "Internal server error" });
  });
}
