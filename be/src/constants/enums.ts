/**
 * Single source of truth for every fixed-value domain in the app.
 *
 * These were Postgres enums until migration 0007. The columns are plain TEXT
 * now, so the database no longer rejects an unknown value — validation lives
 * here and is applied at the request boundary via z.enum(...).
 *
 * Adding a value: add it to the tuple below. No migration needed.
 * Removing a value: check for existing rows first, since the database will
 * happily keep serving data the app no longer considers valid.
 */

export const ROLES = ["DRIVER", "ORGANIZER", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];
export const DEFAULT_ROLE: Role = "DRIVER";

export const LISTING_TYPES = ["EVENT", "RECURRING", "COMMERCIAL"] as const;
export type ListingType = (typeof LISTING_TYPES)[number];
export const DEFAULT_LISTING_TYPE: ListingType = "EVENT";

export const LISTING_STATUSES = [
  "DRAFT",
  "PUBLISHED",
  "ONGOING",
  "COMPLETED",
  "CANCELLED",
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];
export const DEFAULT_LISTING_STATUS: ListingStatus = "DRAFT";

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
export const DEFAULT_BOOKING_STATUS: BookingStatus = "PENDING";

export const PAYMENT_STATUSES = [
  "CREATED",
  "CAPTURED",
  "FAILED",
  "REFUNDED",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const DEFAULT_PAYMENT_STATUS: PaymentStatus = "CREATED";

export const SETTLEMENT_STATUSES = [
  "PENDING",
  "PROCESSING",
  "PAID",
  "DISPUTED",
] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];
export const DEFAULT_SETTLEMENT_STATUS: SettlementStatus = "PENDING";

export const DEVICE_TYPES = ["IOS", "ANDROID", "WEB", "OTHER"] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];
export const DEFAULT_DEVICE_TYPE: DeviceType = "OTHER";
