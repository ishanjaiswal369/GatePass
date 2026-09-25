/**
 * Mirrors be/src/constants/enums/. The API stores these as plain TEXT and
 * validates them with zod at its request boundary, so the two sides have to
 * agree by convention -- keep this file in step when the backend changes.
 */

export const ROLES = ["DRIVER", "ORGANIZER", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

export const DEVICE_TYPES = ["IOS", "ANDROID", "WEB", "OTHER"] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export const VEHICLE_TYPES = ["CAR", "BIKE", "OTHER"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const BOOKING_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "CANCELLED",
  "COMPLETED",
  "NO_SHOW",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const LISTING_TYPES = [
  "EVENT",
  "RECURRING",
  "COMMERCIAL",
  // A private spot rented out by an individual host.
  "INDEPENDENT_SPOT",
] as const;
export type ListingType = (typeof LISTING_TYPES)[number];

export const VERIFICATION_PURPOSES = [
  "LOGIN",
  "PASSWORD_RESET",
  "ACCOUNT_DELETE",
] as const;
export type VerificationPurpose = (typeof VERIFICATION_PURPOSES)[number];

export const VERIFICATION_STATUSES = [
  "PENDING",
  "ACTIVE",
  "REJECTED",
  "SUSPENDED",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const ORGANIZER_MEMBER_ROLES = ["OWNER", "MANAGER", "STAFF"] as const;
export type OrganizerMemberRole = (typeof ORGANIZER_MEMBER_ROLES)[number];

export const PAYMENT_STATUSES = [
  "CREATED",
  "CAPTURED",
  "FAILED",
  "REFUNDED",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Mirrors be/src/constants/enums/amenity.ts. "24/7 access" is derived, not stored. */
export const AMENITIES = [
  "CCTV",
  "SECURITY_GUARD",
  "COVERED",
  "EV_CHARGING",
  "WELL_LIT",
  "WASHROOM",
] as const;
export type Amenity = (typeof AMENITIES)[number];

export const VEHICLE_SIZES = ["HATCHBACK", "SEDAN", "SUV", "VAN"] as const;
export type VehicleSize = (typeof VEHICLE_SIZES)[number];

/** Where a refund stands; separate from the booking it belongs to. */
export const REFUND_STATUSES = ["REFUND_PENDING", "REFUNDED", "FAILED"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const LISTING_STATUSES = [
  "DRAFT",
  "PUBLISHED",
  "ONGOING",
  "COMPLETED",
  "CANCELLED",
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

/** Mirrors be/src/constants/enums/problem.ts, in the Report screen's order. */
export const PROBLEM_CATEGORIES = [
  "CANT_FIND",
  "OCCUPIED",
  "GATE_LOCKED",
  "NOT_AS_LISTED",
  "HOST_UNRESPONSIVE",
  "OTHER",
] as const;
export type ProblemCategory = (typeof PROBLEM_CATEGORIES)[number];

/** Mirrors be/src/constants/enums/notification-kind.ts. */
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
