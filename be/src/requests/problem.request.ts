import { z } from "zod";
import { PROBLEM_CATEGORIES } from "../constants/enums/index.js";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

const bookingParams = z.object({ id: z.string().uuid() });

/**
 * No driver, listing or status: the booking is the path param and the rest
 * is read off it. `.strict()` so a client sending more finds out.
 */
const createBody = z
  .object({
    category: z.enum(PROBLEM_CATEGORIES),
    details: z
      .string()
      .transform((value) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim())
      .pipe(z.string().max(500))
      .transform((value) => (value.length > 0 ? value : undefined))
      .optional(),
    photoUrl: z.string().url().max(1024).optional(),
  })
  .strict();

const presignBody = z
  .object({
    contentType: z.string().min(1).max(100),
    contentLength: z.number().int().positive(),
  })
  .strict();

const resolveBody = z
  .object({
    refund: z.boolean(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const problemRequests = {
  create: { params: bookingParams, body: createBody } satisfies RequestSchemas,
  get: { params: bookingParams } satisfies RequestSchemas,
  presignPhoto: { params: bookingParams, body: presignBody } satisfies RequestSchemas,
  adminList: { query: z.object({ status: z.enum(["OPEN", "RESOLVED"]).default("OPEN") }) } satisfies RequestSchemas,
  resolve: { params: z.object({ id: z.string().uuid() }), body: resolveBody } satisfies RequestSchemas,
};

export type CreateProblemInput = RequestInput<typeof problemRequests.create>;
export type GetProblemInput = RequestInput<typeof problemRequests.get>;
export type PresignProblemPhotoInput = RequestInput<typeof problemRequests.presignPhoto>;
export type AdminListProblemsInput = RequestInput<typeof problemRequests.adminList>;
export type ResolveProblemInput = RequestInput<typeof problemRequests.resolve>;
