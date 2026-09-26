/**
 * How a host is registered with the gateway that pays them (Cashfree Easy
 * Split vendor KYC): as an individual or a business.
 *
 * Mirrored in fe/src/constants/enums.ts.
 */
export const PAYOUT_ACCOUNT_TYPES = ["INDIVIDUAL", "BUSINESS"] as const;

export type PayoutAccountType = (typeof PAYOUT_ACCOUNT_TYPES)[number];

/**
 * A business account's category, asked only for BUSINESS.
 *
 * Cashfree doesn't publish the list of values it accepts. This holds the
 * ones confirmed so far; the rest are added from the Cashfree dashboard's
 * Add Vendor dropdown as they are needed.
 */
export const PAYOUT_BUSINESS_TYPES = ["Travel and Hospitality"] as const;

export type PayoutBusinessType = (typeof PAYOUT_BUSINESS_TYPES)[number];
