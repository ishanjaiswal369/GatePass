export const VERIFICATION_STATUSES = [
  "PENDING",
  "ACTIVE",
  "REJECTED",
  "SUSPENDED",
] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/**
 * Onboarding is self-serve for now, so a new host profile is usable
 * immediately. Automated checks move this back to PENDING later.
 */
export const DEFAULT_VERIFICATION_STATUS: VerificationStatus = "ACTIVE";
