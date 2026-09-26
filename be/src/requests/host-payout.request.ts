import { z } from "zod";
import { PAYOUT_ACCOUNT_TYPES, PAYOUT_BUSINESS_TYPES } from "../constants/enums/index.js";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

/**
 * Format checks only. Whether the account exists and belongs to this person is
 * the gateway's job -- it can penny-drop, we cannot.
 */
const submitPayoutBody = z
  .object({
    panNumber: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{5}\d{4}[A-Z]$/, "must look like ABCDE1234F"),
    accountHolderName: z.string().trim().min(1).max(120),
    accountNumber: z.string().trim().regex(/^\d{9,18}$/, "must be 9-18 digits"),
    ifsc: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "must look like HDFC0001234"),
    accountType: z.enum(PAYOUT_ACCOUNT_TYPES).default("INDIVIDUAL"),
    /** Only for a BUSINESS account. */
    businessType: z.enum(PAYOUT_BUSINESS_TYPES).optional(),
    /**
     * The host's mobile, when their profile has none: the gateway needs one
     * to register them. Normalised and saved to the profile by the service.
     */
    phone: z.string().trim().min(10).max(16).optional(),
  })
  .strict()
  .refine((value) => value.accountType !== "BUSINESS" || value.businessType, {
    path: ["businessType"],
    message: "is required for a business account",
  })
  .refine((value) => value.accountType === "BUSINESS" || !value.businessType, {
    path: ["businessType"],
    message: "is only for a business account",
  });

export const hostPayoutRequests = {
  submit: { body: submitPayoutBody } satisfies RequestSchemas,
};

export type SubmitPayoutInput = RequestInput<typeof hostPayoutRequests.submit>;
