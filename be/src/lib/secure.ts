import { randomInt, timingSafeEqual } from "node:crypto";

/**
 * A six-digit code for sign-in, password reset and account deletion.
 *
 * From the system's CSPRNG, not Math.random: that generator's output can be
 * predicted from a few earlier values, and a code is the whole credential.
 * Always six digits (100000-999999), so it never needs padding.
 */
export function sixDigitCode(): string {
  return randomInt(100_000, 1_000_000).toString();
}

/**
 * Whether two secrets are the same, in time that doesn't depend on where
 * they first differ. `===` stops at the first wrong character, which lets a
 * patient caller find a secret one character at a time.
 *
 * The lengths are compared first; for a code or a signature the length is
 * public anyway.
 */
export function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
