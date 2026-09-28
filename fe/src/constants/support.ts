import { business } from "@/features/legal/content";

/**
 * Where drivers reach a person. The build's environment can point it
 * elsewhere; unset, it is the address published on the Contact page, so the
 * app and the website never give different ones.
 */
export const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL || business.email;

/** A prefilled support email about one booking. */
export function supportMailto(subject: string): string | null {
  return SUPPORT_EMAIL ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}` : null;
}
