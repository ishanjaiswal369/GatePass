import { z } from "zod";
import { DEFAULT_DEVICE_TYPE, DEVICE_TYPES } from "../constants/enums/index.js";
import { normalisePhone } from "../lib/phone.js";
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

const googleSignInBody = z.object({
  // Only the token is trusted from the client. The email and name come out of
  // its verified payload, never from fields the caller could set.
  idToken: z.string().min(1),
  deviceId: z.string().min(1),
  deviceType: z.enum(DEVICE_TYPES).default(DEFAULT_DEVICE_TYPE),
  deviceName: z.string().min(1).optional(),
  fcmToken: z.string().min(1).optional(),
});

/**
 * Normalised here rather than in the service, so everything downstream sees
 * one shape. normalisePhone throws a 400 with a readable message on anything
 * that is not an Indian mobile.
 */
const phoneSchema = z.string().trim().transform(normalisePhone);

/**
 * Minimum length only. Composition rules ("one capital, one symbol") push
 * people towards shorter, more predictable passwords and a manager cannot
 * always satisfy them; length is what actually costs an attacker.
 */
const passwordSchema = z
  .string()
  .min(10, "must be at least 10 characters")
  .max(200);

const updateProfileBody = z
  .object({
    firstName: nameSchema.optional(),
    lastName: nameSchema.nullable().optional(),
    phone: phoneSchema.optional(),
  })
  .refine(
    (value) =>
      value.firstName !== undefined ||
      value.lastName !== undefined ||
      value.phone !== undefined,
    { message: "provide firstName, lastName or phone" }
  );

const requestPasswordCodeBody = z.object({
  email: emailSchema,
  deviceId: z.string().min(1),
  deviceType: z.enum(DEVICE_TYPES).default(DEFAULT_DEVICE_TYPE),
});

const setPasswordBody = z.object({
  email: emailSchema,
  code: z.string().regex(/^\d{6}$/, "must be a 6-digit code"),
  password: passwordSchema,
  deviceId: z.string().min(1),
  deviceType: z.enum(DEVICE_TYPES).default(DEFAULT_DEVICE_TYPE),
  deviceName: z.string().min(1).optional(),
  fcmToken: z.string().min(1).optional(),
});

const loginBody = z.object({
  email: emailSchema,
  // Not passwordSchema: an old password that predates a rule change must
  // still be able to log in and be changed.
  password: z.string().min(1),
  deviceId: z.string().min(1),
  deviceType: z.enum(DEVICE_TYPES).default(DEFAULT_DEVICE_TYPE),
  deviceName: z.string().min(1).optional(),
  fcmToken: z.string().min(1).optional(),
});

const changePasswordBody = z.object({
  // Not passwordSchema: the current password may predate a rule change, and
  // refusing it here would lock that user out of changing it.
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

const removeSessionParams = z.object({
  sessionId: z.string().uuid(),
});

export const authRequests = {
  requestCode: { body: requestCodeBody } satisfies RequestSchemas,
  verifyCode: { body: verifyCodeBody } satisfies RequestSchemas,
  googleSignIn: { body: googleSignInBody } satisfies RequestSchemas,
  updateProfile: { body: updateProfileBody } satisfies RequestSchemas,
  requestPasswordCode: { body: requestPasswordCodeBody } satisfies RequestSchemas,
  setPassword: { body: setPasswordBody } satisfies RequestSchemas,
  login: { body: loginBody } satisfies RequestSchemas,
  changePassword: { body: changePasswordBody } satisfies RequestSchemas,
  removeSession: { params: removeSessionParams } satisfies RequestSchemas,
};

export type RequestCodeInput = RequestInput<typeof authRequests.requestCode>;
export type VerifyCodeInput = RequestInput<typeof authRequests.verifyCode>;
export type GoogleSignInInput = RequestInput<typeof authRequests.googleSignIn>;
export type UpdateProfileInput = RequestInput<typeof authRequests.updateProfile>;
export type RemoveSessionInput = RequestInput<typeof authRequests.removeSession>;
export type RequestPasswordCodeInput = RequestInput<
  typeof authRequests.requestPasswordCode
>;
export type SetPasswordInput = RequestInput<typeof authRequests.setPassword>;
export type LoginInput = RequestInput<typeof authRequests.login>;
export type ChangePasswordInput = RequestInput<
  typeof authRequests.changePassword
>;
