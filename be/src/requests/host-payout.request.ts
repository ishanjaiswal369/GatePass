import { z } from "zod";
import { PAYOUT_ACCOUNT_TYPES, PAYOUT_BUSINESS_TYPES } from "../constants/enums/index.js";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

/**
 * POST /host/payout-account -- the accepted payload, and nothing else
 * (`.strict()`: an unknown field is a 400, not silently dropped).
 *
 *   {
 *     "accountType":       "INDIVIDUAL" | "BUSINESS",          required
 *     "businessType":      one of PAYOUT_BUSINESS_TYPES,       BUSINESS only (required there)
 *     "panNumber":         "ABCDE1234F",                       required
 *     "accountHolderName": "RAVI KUMAR",                       required, 1-120
 *     "accountNumber":     "026291800001191",                  required, 9-18 digits
 *     "ifsc":              "YESB0000262",                      required
 *     "phone":             "9876543210"                        only when the profile has none
 *   }
 *
 * An individual isn't asked for a business type and none is sent to the
 * gateway for them; a business picks its own and must.
 *
 * Format checks only. Whether the account exists and belongs to this person is
 * the gateway's job -- it can penny-drop, we cannot.
 */
const submitPayoutBody = z
  .object({
    accountType: z.enum(PAYOUT_ACCOUNT_TYPES),
    businessType: z.enum(PAYOUT_BUSINESS_TYPES).optional(),
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
    /**
     * The host's mobile, when their profile has none: the gateway needs one
     * to register them. Ten digits, with or without +91; saved to the
     * profile by the service.
     */
    phone: z
      .string()
      .trim()
      .regex(/^(\+91)?[6-9]\d{9}$/, "must be a 10-digit Indian mobile number")
      .optional(),
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
