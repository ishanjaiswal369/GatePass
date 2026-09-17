export const PAYMENT_STATUSES = [
  "CREATED",
  "CAPTURED",
  "FAILED",
  "REFUNDED",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const DEFAULT_PAYMENT_STATUS: PaymentStatus = "CREATED";
