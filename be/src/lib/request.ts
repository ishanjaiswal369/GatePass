import type { FastifyReply, FastifyRequest, RouteHandlerMethod } from "fastify";
import { z } from "zod";
import { ValidationError } from "./errors.js";

export interface RequestSchemas {
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
}

export type RequestInput<S extends RequestSchemas> = {
  [K in keyof S as S[K] extends z.ZodTypeAny ? K : never]: S[K] extends z.ZodTypeAny
    ? z.output<S[K]>
    : never;
};

export type RequestHandler<S extends RequestSchemas> = (
  input: RequestInput<S>,
  request: FastifyRequest,
  reply: FastifyReply
) => unknown;

export function request<S extends RequestSchemas>(
  schemas: S,
  handler: RequestHandler<S>
): RouteHandlerMethod {
  return async (request, reply) => {
    const input: Record<string, unknown> = {};
    const issues: z.ZodIssue[] = [];

    for (const key of ["body", "query", "params"] as const) {
      const schema = schemas[key];
      if (!schema) continue;

      const result = schema.safeParse(request[key]);

      if (result.success) {
        input[key] = result.data;
      } else {
        issues.push(...result.error.issues);
      }
    }

    if (issues.length > 0) {
      throw new ValidationError(issues);
    }

    await handler(input as RequestInput<S>, request, reply);
  };
}
