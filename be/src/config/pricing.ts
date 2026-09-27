/**
 * What GatePass charges, and what it gives back.
 *
 * One place for every number the business may want to change, so a new fee
 * or a kinder cancellation rule is an edit here rather than a hunt through
 * services. Amounts are rupees.
 *
 * One source of revenue: the service fee, a share of each booking's parking
 * amount taken from the host's side (COMMISSION_RATE in .env). The driver pays
 * the listed price with nothing on top -- there is no driver-side fee.
 */
import { Prisma } from "@prisma/client";
import { env } from "./env.js";

export const pricing = {
  /** GatePass's service fee: the share of the parking amount it keeps; the host is paid the rest. */
  hostCommissionRate: env.COMMISSION_RATE,
};

/**
 * The host's part of a parking amount: all of it less the service fee, to the
 * paisa. One function for both places that need it -- the split sent to the
 * gateway with each order, and the earnings the host reads -- so what a host
 * is shown and what reaches their bank can't drift apart.
 */
export function hostShareOf(parking: Prisma.Decimal): Prisma.Decimal {
  return parking.mul(1 - pricing.hostCommissionRate).toDecimalPlaces(2);
}

/**
 * GST, for when it is charged. GatePass's GST falls on its own supply -- the
 * service fee -- not on the parking, which is the host's. Nothing charges it
 * yet: turning GST_ENABLED on is where that work starts.
 */
export const gst = {
  enabled: env.GST_ENABLED,
  rate: env.GST_RATE,
};

/** How much extra time a parked driver can buy at once, in minutes. */
export const EXTENSION_STEPS = [30, 60, 120] as const;

/**
 * The cancellation policy, in the order it is applied.
 *
 * - Before `freeUntilMinutesBefore` of the start: everything the driver paid
 *   comes back.
 * - After that and before the start: `lateRefundRate` of the parking amount.
 * - Once the stay has started: nothing, and the booking cannot be cancelled
 *   -- a driver who cannot use the space reports a problem instead, which is
 *   reviewed by a person.
 */
export const cancellationPolicy = {
  freeUntilMinutesBefore: 60,
  lateRefundRate: 0.5,
};
