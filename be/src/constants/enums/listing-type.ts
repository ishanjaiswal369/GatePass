export const LISTING_TYPES = [
  "EVENT",
  "RECURRING",
  "COMMERCIAL",
  // A private spot rented out by an individual host. Same engine as an event
  // listing -- the split in this product is actor complexity, not B2B vs C2C.
  "INDEPENDENT_SPOT",
] as const;

export type ListingType = (typeof LISTING_TYPES)[number];

export const DEFAULT_LISTING_TYPE: ListingType = "EVENT";
