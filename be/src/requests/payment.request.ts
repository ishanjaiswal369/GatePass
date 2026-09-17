import { z } from "zod";
import { PAYMENT_STATUSES } from "../constants/enums.js";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

const createPaymentBody = z.object({
  bookingId: z.string().uuid(),
  razorpayOrderId: z.string().min(1).optional(),
  razorpayPaymentId: z.string().min(1).optional(),
  amount: z.number().nonnegative(),
  status: z.enum(PAYMENT_STATUSES).optional(),
});

export const paymentRequests = {
  create: { body: createPaymentBody } satisfies RequestSchemas,
};

export type CreatePaymentInput = RequestInput<typeof paymentRequests.create>;
