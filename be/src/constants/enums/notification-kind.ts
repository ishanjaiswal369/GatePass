/**
 * Every kind of inbox entry, and which preference switches it off.
 *
 * `null` means always delivered: booking confirmations and cancellations are
 * receipts, not reminders, and the Settings screen shows them as "Always on".
 */
export const NOTIFICATION_KINDS = {
  BOOKING_CONFIRMED: null,
  BOOKING_CANCELLED: null,
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
  HOST_LISTING_STATUS: "hostListing",
} as const;

export type NotificationKind = keyof typeof NOTIFICATION_KINDS;

/** The switches on the Settings tab, in its order. */
export const NOTIFICATION_PREFERENCES = [
  "startingSoon",
  "endingSoon",
  "refunds",
  "reviewReminders",
  "hostNewBookings",
  "hostPayouts",
  "hostListing",
  "push",
  "email",
  "offers",
] as const;

export type NotificationPreferenceKey = (typeof NOTIFICATION_PREFERENCES)[number];
