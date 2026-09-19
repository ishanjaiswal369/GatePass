export const VERIFICATION_PURPOSES = ["LOGIN", "PASSWORD_RESET"] as const;

export type VerificationPurpose = (typeof VERIFICATION_PURPOSES)[number];

export const DEFAULT_VERIFICATION_PURPOSE: VerificationPurpose = "LOGIN";
