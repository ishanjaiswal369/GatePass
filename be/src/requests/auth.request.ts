import { z } from "zod";
import { DEFAULT_DEVICE_TYPE, DEVICE_TYPES } from "../constants/enums/index.js";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("must be a valid email address");

// lastName stays optional: mononyms are common and a required surname would
// lock those users out of signup.
const nameSchema = z.string().trim().min(1).max(100);

const requestCodeBody = z.object({
  email: emailSchema,
  deviceId: z.string().min(1),
  deviceType: z.enum(DEVICE_TYPES).default(DEFAULT_DEVICE_TYPE),
  // Sent from the signup screen only. The sign-in screen omits both.
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
});

const verifyCodeBody = z.object({
  email: emailSchema,
  code: z.string().regex(/^\d{6}$/, "must be a 6-digit code"),
  deviceId: z.string().min(1),
  deviceType: z.enum(DEVICE_TYPES).default(DEFAULT_DEVICE_TYPE),
  deviceName: z.string().min(1).optional(),
  fcmToken: z.string().min(1).optional(),
});

const updateProfileBody = z
  .object({
    firstName: nameSchema.optional(),
    lastName: nameSchema.nullable().optional(),
  })
  .refine(
    (value) => value.firstName !== undefined || value.lastName !== undefined,
    { message: "provide firstName or lastName" }
  );

const removeSessionParams = z.object({
  sessionId: z.string().uuid(),
});

export const authRequests = {
  requestCode: { body: requestCodeBody } satisfies RequestSchemas,
  verifyCode: { body: verifyCodeBody } satisfies RequestSchemas,
  updateProfile: { body: updateProfileBody } satisfies RequestSchemas,
  removeSession: { params: removeSessionParams } satisfies RequestSchemas,
};

export type RequestCodeInput = RequestInput<typeof authRequests.requestCode>;
export type VerifyCodeInput = RequestInput<typeof authRequests.verifyCode>;
export type UpdateProfileInput = RequestInput<typeof authRequests.updateProfile>;
export type RemoveSessionInput = RequestInput<typeof authRequests.removeSession>;
