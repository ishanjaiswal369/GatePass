import type { Prisma } from "@prisma/client";

/**
 * Published, host verified, payout active: the gates every driver read of a
 * host spot applies -- search, detail, quote, saving, reviews. In the WHERE
 * clause each time, so "not bookable" and "does not exist" answer alike.
 */
export const BOOKABLE_SPOT = {
  listingType: "INDEPENDENT_SPOT",
  status: { in: ["PUBLISHED", "ONGOING"] },
  hostProfile: { verificationStatus: "ACTIVE", payoutKycStatus: "ACTIVATED" },
} satisfies Prisma.ListingWhereInput;
