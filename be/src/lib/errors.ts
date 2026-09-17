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

export const notFound = (message: string) =>
  new AppError(message, 404, "NOT_FOUND");

export const conflict = (message: string) =>
  new AppError(message, 409, "CONFLICT");

export function registerErrorHandler(app: App): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ValidationError) {
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
