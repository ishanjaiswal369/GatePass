import { z } from "zod";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

/**
 * Starting a UPI payment. No amount, order id, session or link is accepted:
 * all of those come from the booking row and the gateway. What the app sends
 * is how to present the payment -- open an app, or show a QR -- and what
 * device it is on, which the gateway uses to pick its UPI flow. Enums only,
 * so nothing typed here reaches the gateway as free text.
 */
const startUpiBody = z
  .object({
    channel: z.enum(["INTENT", "QR"]),
    client: z
      .object({
        device: z.enum(["mobile", "desktop", "tablet"]),
        os: z.enum(["android", "ios", "windows", "macos", "linux", "others"]),
        rendering: z.enum(["native", "mweb", "webview"]).optional(),
        browser: z.enum(["chrome", "safari", "firefox", "edge", "others"]),
      })
      .strict(),
  })
  .strict();

const bookingIdParams = z.object({ id: z.string().uuid() });

/** Only the order id: the gateway may add others, and they are ignored. */
const returnQuery = z.object({ order_id: z.string().max(64) });

export const paymentRequests = {
  startUpi: { params: bookingIdParams, body: startUpiBody } satisfies RequestSchemas,
  paymentReturn: { query: returnQuery } satisfies RequestSchemas,
};

export type StartUpiInput = RequestInput<typeof paymentRequests.startUpi>;
export type PaymentReturnInput = RequestInput<typeof paymentRequests.paymentReturn>;
