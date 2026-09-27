import type { PaymentClientHints, PaymentOptions, UpiPaymentStart } from "@/types/api.types";
import { request } from "./client";

/** Whether online payment is on, and which methods the checkout may offer. */
export const options = (token: string) => request<PaymentOptions>("/payments/options", { token });

/**
 * A UPI attempt on the booking's order. Each call is a new attempt on the
 * same order, so switching app or asking for a QR is just another call.
 */
export const startUpi = (
  token: string,
  bookingId: string,
  input: { channel: "INTENT" | "QR"; client: PaymentClientHints }
) => request<UpiPaymentStart>(`/bookings/${bookingId}/pay/upi`, { method: "POST", body: input, token });
