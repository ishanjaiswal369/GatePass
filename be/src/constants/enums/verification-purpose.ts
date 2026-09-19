export const VERIFICATION_PURPOSES = [
  "LOGIN",
  "PASSWORD_RESET",
  // Confirms "delete my account". Its own purpose so a login or reset code can
  // never authorise a deletion, and deletion codes never sign anyone in.
  "ACCOUNT_DELETE",
] as const;

export type VerificationPurpose = (typeof VERIFICATION_PURPOSES)[number];

export const DEFAULT_VERIFICATION_PURPOSE: VerificationPurpose = "LOGIN";
