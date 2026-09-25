/**
 * The structured answers of the listing wizard (host onboarding v2).
 *
 * Stored as TEXT on Listing; these lists are what the API accepts.
 */

/** How a driver gets in. Public: it helps a driver decide; the code itself doesn't. */
export const ENTRY_METHODS = [
  "SECURITY_GUARD",
  "GATE_CODE",
  "INTERCOM",
  "MANUAL_GATE",
  "OPEN_ACCESS",
  "OTHER",
] as const;

export type EntryMethod = (typeof ENTRY_METHODS)[number];

/** What the ownership proof is. Private: host and admins only. */
export const OWNERSHIP_DOC_TYPES = ["ELECTRICITY_BILL", "PROPERTY_TAX", "ALLOTMENT_LETTER", "OTHER"] as const;

export type OwnershipDocType = (typeof OWNERSHIP_DOC_TYPES)[number];

/** Owning a space and being allowed to rent someone else's are different promises. */
export const PERMISSION_BASES = ["OWNER", "OWNER_PERMISSION"] as const;

export type PermissionBasis = (typeof PERMISSION_BASES)[number];

/** The wizard's steps, as the API names them in readiness items and rejections. */
export const LISTING_SECTIONS = [
  "type",
  "address",
  "photos",
  "details",
  "availability",
  "pricing",
  "access",
  "documents",
  "payout",
] as const;

export type ListingSection = (typeof LISTING_SECTIONS)[number];
