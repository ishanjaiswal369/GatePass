/**
 * "Rahul S.": a first name and an initial -- enough to put a face to a host at
 * the gate or a voice to a review, not enough to look anyone up. The one rule
 * for how a person is named to people who are not them.
 */
export function publicName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  fallback: string
): string {
  const first = firstName?.trim();
  if (!first) return fallback;
  const initial = lastName?.trim().charAt(0);
  return `${first}${initial ? ` ${initial.toUpperCase()}.` : ""}`;
}
