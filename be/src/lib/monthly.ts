import { startOfVenueDay, addDays, venueDate, weekdayOf } from "./venue-calendar.js";

/**
 * The weekly pattern a monthly reservation holds, and the arithmetic every
 * claim path shares (search, quote, hourly booking, extension, host block,
 * another reservation).
 *
 * An *occurrence* is one chosen weekday inside [startDate, endDate), from
 * startMinute to endMinute, in the venue's (IST) time. Dates are
 * "YYYY-MM-DD"; endDate is exclusive.
 */
export interface Term {
  days: number[];
  startMinute: number;
  endMinute: number;
  startDate: string;
  endDate: string;
}

/**
 * startDate + n calendar months. The 31st of a month with no 31st lands on
 * that month's last day (31 Jan + 1 month = 28/29 Feb), never spills into
 * the month after.
 */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Every occurrence of the term that touches [from, to), as instants. */
export function occurrencesBetween(term: Term, from: Date, to: Date): { start: Date; end: Date }[] {
  const first = [term.startDate, venueDate(from)].sort().at(-1)!;
  // The day before `from` too: an occurrence can't cross midnight (endMinute
  // <= 1440), but being inclusive here costs one iteration and no thought.
  const last = [term.endDate, addDays(venueDate(to), 1)].sort()[0]!;
  const out: { start: Date; end: Date }[] = [];
  for (let date = first; date < last; date = addDays(date, 1)) {
    if (!term.days.includes(weekdayOf(date))) continue;
    const dayStart = startOfVenueDay(date).getTime();
    const start = new Date(dayStart + term.startMinute * 60_000);
    const end = new Date(dayStart + term.endMinute * 60_000);
    if (start < to && end > from) out.push({ start, end });
  }
  return out;
}

/** Every occurrence of the whole term. At most 12 months x 7 days. */
export function allOccurrences(term: Term): { start: Date; end: Date }[] {
  return occurrencesBetween(term, startOfVenueDay(term.startDate), startOfVenueDay(term.endDate));
}

/** Whether a term claims any part of [start, end). */
export function termOverlapsRange(term: Term, start: Date, end: Date): boolean {
  return occurrencesBetween(term, start, end).length > 0;
}

/** Whether two terms ever claim the same minute: a shared date that is a chosen weekday of both, with overlapping hours. */
export function termsOverlap(a: Term, b: Term): boolean {
  if (a.startMinute >= b.endMinute || b.startMinute >= a.endMinute) return false;
  const from = [a.startDate, b.startDate].sort()[1]!;
  const to = [a.endDate, b.endDate].sort()[0]!;
  for (let date = from; date < to; date = addDays(date, 1)) {
    const wd = weekdayOf(date);
    if (a.days.includes(wd) && b.days.includes(wd)) return true;
  }
  return false;
}

/** How many of the term's months have begun by `now` (0 before it starts). */
export function monthsStarted(startDate: string, months: number, now: Date): number {
  let started = 0;
  for (let i = 0; i < months; i++) {
    if (startOfVenueDay(addMonths(startDate, i)) <= now) started++;
  }
  return started;
}

/** How many of the term's months have ended by `now`. */
export function monthsEnded(startDate: string, months: number, now: Date): number {
  let ended = 0;
  for (let i = 1; i <= months; i++) {
    if (startOfVenueDay(addMonths(startDate, i)) <= now) ended++;
  }
  return ended;
}

/** A reservation still claiming its hours: paid, or a hold not yet lapsed. */
export function activeTermWhere(now: Date) {
  return { OR: [{ status: "CONFIRMED" }, { status: "PENDING", holdExpiresAt: { gt: now } }] };
}
