/**
 * What a driver is looking for, and how it survives a navigation.
 *
 * The search form and the results screen are two routes, so the criteria have
 * to cross a URL. They are encoded as plain query params rather than held in a
 * provider: a results screen is exactly the thing a driver reloads, shares or
 * lands on from history, and state kept in memory does not survive any of
 * those.
 */

/**
 * The shortest stay worth selling. Below this the fee is smaller than the
 * cost of the driver walking to the spot.
 */
export const MIN_STAY_MINUTES = 15;

/** How far ahead a stay can be booked. */
export const MAX_DAYS_AHEAD = 60;

/** The longest single stay. */
export const MAX_STAY_DAYS = 30;

export interface SearchPlace {
  latitude: number;
  longitude: number;
  /** What the driver picked, shown back to them so the search is legible. */
  label: string;
}

export interface SearchCriteria {
  place: SearchPlace;
  /** Instants, so a device in another timezone still asks about the right moment. */
  from: string;
  to: string;
}

// ------------------------------------------------------------------ dates --

/** YYYY-MM-DD in the device's own timezone, not UTC. `toISOString` would shift. */
export function toDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${String(date.getDate()).padStart(2, "0")}`;
}

export function fromDateKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** A day key plus a minute-of-day, as an instant. */
export function atMinute(dateKey: string, minute: number): Date {
  const date = fromDateKey(dateKey);
  date.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  return date;
}

/** "Today", "Tomorrow", then "Wed 24 Sep". */
export function dayLabel(date: Date): string {
  const today = new Date();
  const days = Math.round(
    (fromDateKey(toDateKey(date)).getTime() -
      fromDateKey(toDateKey(today)).getTime()) /
      86_400_000
  );

  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";

  return date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** Rounds up to the next step, so "now" is never offered as an arrival time. */
export function nextStepMinute(from: Date, step: number): number {
  const minutes = from.getHours() * 60 + from.getMinutes();
  return Math.min(Math.ceil((minutes + 1) / step) * step, 24 * 60 - step);
}

// ----------------------------------------------------------------- params --

export function toParams(criteria: SearchCriteria): Record<string, string> {
  return {
    latitude: String(criteria.place.latitude),
    longitude: String(criteria.place.longitude),
    place: criteria.place.label,
    from: criteria.from,
    to: criteria.to,
  };
}

/**
 * Rebuilds the criteria a results screen was opened with.
 *
 * Returns null rather than a partial object when anything is missing or
 * unparseable: these arrive from a URL, so they can be hand-edited, truncated
 * by a share, or left over from an older version of this screen. A search with
 * half its criteria would quietly answer the wrong question.
 */
export function fromParams(
  params: Record<string, string | string[] | undefined>
): SearchCriteria | null {
  const read = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const latitude = Number(read("latitude"));
  const longitude = Number(read("longitude"));

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const place: SearchPlace = {
    latitude,
    longitude,
    label: read("place") ?? "Selected area",
  };

  const from = read("from");
  const to = read("to");

  if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    return null;
  }

  if (Date.parse(to) - Date.parse(from) < MIN_STAY_MINUTES * 60_000) return null;

  return { place, from, to };
}

/**
 * A stretch of time, in one line. Collapses the day when both ends fall on
 * it, so an ordinary afternoon does not read like an overnight stay.
 */
export function describeRange(from: Date, to: Date): string {
  const time = (date: Date) =>
    date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  return toDateKey(from) === toDateKey(to)
    ? `${dayLabel(from)}, ${time(from)} – ${time(to)}`
    : `${dayLabel(from)} ${time(from)} – ${dayLabel(to)} ${time(to)}`;
}

/** "45 min", "2 hours", "3 hours 30 min". Days stay in hours: a driver books
 *  a car park by the hour and reads a bill the same way. */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${rest} min`;

  const hourPart = `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return rest === 0 ? hourPart : `${hourPart} ${rest} min`;
}

/** How the search reads back to the driver, on the results screen. */
export function describeCriteria(criteria: SearchCriteria): string {
  return describeRange(new Date(criteria.from), new Date(criteria.to));
}
