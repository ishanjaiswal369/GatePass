/**
 * Where a host stands with the payment gateway that will pay them.
 *
 * Deliberately gateway-neutral: this mirrors whatever the provider reports
 * (Cashfree vendor status today), so switching or adding a provider is a
 * mapping change in the integration layer, not a migration.
 *
 * This is NOT HostProfile.verificationStatus. That one is our own product
 * check on the spot; this one is "can money actually reach this person".
 * A host needs both before their listing goes live.
 */
export const PAYOUT_KYC_STATUSES = [
  "NOT_STARTED",
  "PENDING",
  "UNDER_REVIEW",
  "ACTIVATED",
  "REJECTED",
] as const;

export type PayoutKycStatus = (typeof PAYOUT_KYC_STATUSES)[number];

export const DEFAULT_PAYOUT_KYC_STATUS: PayoutKycStatus = "NOT_STARTED";
