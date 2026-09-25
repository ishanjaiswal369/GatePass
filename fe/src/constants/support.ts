/**
 * Where drivers reach a person. Read from the build's environment rather than
 * written here, so the address can change without a code change and nothing
 * personal is baked into the bundle by default. Unset, the app says support
 * isn't reachable from this build instead of opening a blank email.
 */
export const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL || null;

/** The published terms/privacy pages (the compliance site under docs/). */
export const LEGAL_BASE_URL = process.env.EXPO_PUBLIC_LEGAL_BASE_URL || null;

/** A prefilled support email about one booking. */
export function supportMailto(subject: string): string | null {
  return SUPPORT_EMAIL ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}` : null;
}
