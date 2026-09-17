import { z } from "zod";
import { ROLES } from "../constants/enums/index.js";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("must be a valid email address");

const createUserBody = z.object({
  email: emailSchema,
  name: z.string().min(1).optional(),
  role: z.enum(ROLES).optional(),
  phone: z.string().regex(/^\d{10}$/, "must be a 10-digit number").optional(),
});

const getUserByIdParams = z.object({
  id: z.string().uuid(),
});

export const userRequests = {
  create: { body: createUserBody } satisfies RequestSchemas,
  getById: { params: getUserByIdParams } satisfies RequestSchemas,
};

export type CreateUserInput = RequestInput<typeof userRequests.create>;
export type GetUserByIdInput = RequestInput<typeof userRequests.getById>;
