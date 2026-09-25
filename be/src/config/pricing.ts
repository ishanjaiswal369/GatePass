/**
 * What GatePass charges, and what it gives back.
 *
 * One place for every number the business may want to change, so a new fee
 * or a kinder cancellation rule is an edit here rather than a hunt through
 * services. Amounts are rupees.
 */
export const pricing = {
  /** Added to the driver's bill on every booking, on top of the parking. */
  platformFee: 20,
  /** GST charged on the platform fee (the parking itself is the host's supply). */
  platformFeeGstRate: 0.18,
  /** Taken from the host's share of the parking amount. */
  hostCommissionRate: 0.1,
  /**
   * A monthly reservation's platform fee: this share of its parking amount
   * (owner's decision, Phase 6), with platformFeeGstRate GST on top. Hourly
   * bookings keep the flat platformFee.
   */
  monthlyPlatformFeeRate: 0.05,
};

/** The terms a monthly reservation can run for, in months. */
export const MONTHLY_TERMS = [1, 3, 6, 12] as const;

/** How much extra time a parked driver can buy at once, in minutes. */
export const EXTENSION_STEPS = [30, 60, 120] as const;

/**
 * The cancellation policy, in the order it is applied.
 *
 * - Before `freeUntilMinutesBefore` of the start: everything the driver paid
 *   comes back, platform fee included.
 * - After that and before the start: `lateRefundRate` of the parking amount;
 *   the platform fee is kept.
 * - Once the stay has started: nothing, and the booking cannot be cancelled
 *   -- a driver who cannot use the space reports a problem instead, which is
 *   reviewed by a person.
 */
export const cancellationPolicy = {
  freeUntilMinutesBefore: 60,
  lateRefundRate: 0.5,
};
