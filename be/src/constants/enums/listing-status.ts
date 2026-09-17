export const LISTING_STATUSES = [
  "DRAFT",
  "PUBLISHED",
  "ONGOING",
  "COMPLETED",
  "CANCELLED",
] as const;

export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const DEFAULT_LISTING_STATUS: ListingStatus = "DRAFT";
