/**
 * A host's booking rules (host onboarding v2): the shortest and longest stay
 * they take, and how far ahead a stay may start. Null is "no rule of my own"
 * -- the platform's limits still apply.
 *
 * One function, used by search, the quote, the booking and extra time, so the
 * reason a driver reads is the same wherever the stay is refused.
 */
export interface BookingRules {
  minStayMinutes: number | null;
  maxStayMinutes: number | null;
  advanceDays: number | null;
}

/** "2 hours", "90 minutes", "1 day". */
export function durationText(minutes: number): string {
  if (minutes % 1440 === 0) return minutes === 1440 ? "1 day" : `${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? "1 hour" : `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

/** Why this stay breaks the rules, or null. `minutes` is the whole stay, extra time included. */
export function ruleViolation(
  rules: BookingRules,
  stay: { startsAt: Date; minutes: number },
  now = new Date()
): string | null {
  if (rules.minStayMinutes && stay.minutes < rules.minStayMinutes) {
    return `This space takes bookings of at least ${durationText(rules.minStayMinutes)}.`;
  }
  if (rules.maxStayMinutes && stay.minutes > rules.maxStayMinutes) {
    return `This space takes bookings of up to ${durationText(rules.maxStayMinutes)}.`;
  }
  return startTooFar(rules, stay.startsAt, now);
}

/** Just the advance-booking rule: for a monthly term, whose length the host's stay rules don't govern. */
export function startTooFar(rules: Pick<BookingRules, "advanceDays">, startsAt: Date, now = new Date()): string | null {
  if (rules.advanceDays && startsAt.getTime() > now.getTime() + rules.advanceDays * 86_400_000) {
    return `This space can be booked up to ${rules.advanceDays} days ahead.`;
  }
  return null;
}

export const bookingRuleSelect = { minStayMinutes: true, maxStayMinutes: true, advanceDays: true } as const;
