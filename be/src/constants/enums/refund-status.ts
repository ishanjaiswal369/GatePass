/**
 * Where a refund stands. Separate from the booking's status: a booking is
 * CANCELLED as soon as the driver cancels, and stays so while the money is
 * still on its way back.
 */
export const REFUND_STATUSES = ["REFUND_PENDING", "REFUNDED", "FAILED"] as const;

export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const DEFAULT_REFUND_STATUS: RefundStatus = "REFUND_PENDING";
