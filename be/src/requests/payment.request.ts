import { z } from "zod";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

/**
 * amount and status are absent by design -- both are derived from the booking
 * in payment.service. razorpayPaymentId arrives from the webhook, never from
 * the app.
 */
const createPaymentBody = z.object({
  bookingId: z.string().uuid(),
  razorpayOrderId: z.string().min(1).optional(),
});

export const paymentRequests = {
  create: { body: createPaymentBody } satisfies RequestSchemas,
};

export type CreatePaymentInput = RequestInput<typeof paymentRequests.create>;
