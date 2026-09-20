import { z } from "zod";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

/**
 * Format checks only. Whether the account exists and belongs to this person is
 * the gateway's job -- it can penny-drop, we cannot.
 */
const submitPayoutBody = z.object({
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
});

export const hostPayoutRequests = {
  submit: { body: submitPayoutBody } satisfies RequestSchemas,
};

export type SubmitPayoutInput = RequestInput<typeof hostPayoutRequests.submit>;
