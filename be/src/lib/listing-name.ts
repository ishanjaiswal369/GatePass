/**
 * Whether a listing name reads as an advert rather than a place.
 *
 * Drivers pick a space by what and where it is; "Best Parking in Pune!!!"
 * says neither, and a claim like "cheapest" is one GatePass would be making
 * on the host's behalf. The rule is deliberately small -- shouting, stacked
 * punctuation and a short list of superlatives -- so it refuses adverts
 * without second-guessing ordinary names. Mirrored in the app for the inline
 * message; this is the check that counts.
 */
const SUPERLATIVES = /\b(best|cheapest|lowest|top|number\s*one|no\.?\s*1|guaranteed|guarantee)\b|#\s*1\b|100\s*%/i;

export const NAME_EXAMPLE = "Covered parking near Kothrud Depot";

export function promotionalNameReason(name: string): string | null {
  const trimmed = name.trim();
  if (/[!?]{2,}/.test(trimmed)) return "Leave out repeated ! or ?.";
  if (SUPERLATIVES.test(trimmed)) return "Leave out claims like “best” or “cheapest” — say what and where the space is.";
  const letters = trimmed.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 6 && letters === letters.toUpperCase()) return "Don't write the name in capitals.";
  return null;
}
