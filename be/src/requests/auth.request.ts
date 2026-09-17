import { z } from "zod";
import { DEFAULT_DEVICE_TYPE, DEVICE_TYPES } from "../constants/enums/index.js";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("must be a valid email address");

const requestOtpBody = z.object({
  email: emailSchema,
  deviceId: z.string().min(1),
  deviceType: z.enum(DEVICE_TYPES).default(DEFAULT_DEVICE_TYPE),
});

const verifyOtpBody = z.object({
  email: emailSchema,
  otp: z.string().regex(/^\d{6}$/, "must be a 6-digit code"),
  deviceId: z.string().min(1),
  deviceType: z.enum(DEVICE_TYPES).default(DEFAULT_DEVICE_TYPE),
  deviceName: z.string().min(1).optional(),
  fcmToken: z.string().min(1).optional(),
});

const removeSessionParams = z.object({
  sessionId: z.string().uuid(),
});

export const authRequests = {
  requestOtp: { body: requestOtpBody } satisfies RequestSchemas,
  verifyOtp: { body: verifyOtpBody } satisfies RequestSchemas,
  removeSession: { params: removeSessionParams } satisfies RequestSchemas,
};

export type RequestOtpInput = RequestInput<typeof authRequests.requestOtp>;
export type VerifyOtpInput = RequestInput<typeof authRequests.verifyOtp>;
export type RemoveSessionInput = RequestInput<typeof authRequests.removeSession>;
