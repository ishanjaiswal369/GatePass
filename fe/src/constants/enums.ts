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

export const VERIFICATION_PURPOSES = ["LOGIN", "PASSWORD_RESET"] as const;
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

export const LISTING_STATUSES = [
  "DRAFT",
  "PUBLISHED",
  "ONGOING",
  "COMPLETED",
  "CANCELLED",
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];
