import type { SettingKey } from "../user-settings.js";

/**
 * Every kind of inbox entry, and which user setting (UserSettings column)
 * switches it off.
 *
 * `null` means always delivered: booking confirmations and cancellations are
 * receipts, not reminders, and the Settings screen shows them as "Always on".
 */
export const NOTIFICATION_KINDS = {
  BOOKING_CONFIRMED: null,
  BOOKING_CANCELLED: null,
  /** Extra time bought on a stay: a receipt, like a confirmation. */
  BOOKING_EXTENDED: null,
  /** A payment attempt failed; the hold may still be open to try again. */
  PAYMENT_FAILED: null,
  /** The 15-minute hold ran out unpaid and the time was released. */
  HOLD_EXPIRED: null,
  STARTING_SOON: "startingSoon",
  ENDING_SOON: "endingSoon",
  REFUND_STARTED: "refunds",
  REFUND_SENT: "refunds",
  REVIEW_REMINDER: "reviewReminders",
  PROBLEM_LOGGED: null,
  PROBLEM_RESOLVED: null,
  HOST_NEW_BOOKING: "hostNewBookings",
  HOST_PROBLEM_REPORTED: null,
  HOST_PAYOUT: "hostPayouts",
  /** The payout account (gateway payee) became active: bookings can be paid out. */
  HOST_PAYOUT_ACTIVE: "hostPayouts",
  HOST_LISTING_STATUS: "hostListing",
  /** Acknowledges the host's own submit; the review outcome is HOST_LISTING_STATUS. */
  HOST_LISTING_SUBMITTED: "hostListing",
} as const satisfies Record<string, SettingKey | null>;

export type NotificationKind = keyof typeof NOTIFICATION_KINDS;

/** The settings that switch a kind of notification off. */
export type NotificationSwitch = NonNullable<(typeof NOTIFICATION_KINDS)[NotificationKind]>;
