export const LISTING_TYPES = ["EVENT", "RECURRING", "COMMERCIAL"] as const;

export type ListingType = (typeof LISTING_TYPES)[number];

export const DEFAULT_LISTING_TYPE: ListingType = "EVENT";
