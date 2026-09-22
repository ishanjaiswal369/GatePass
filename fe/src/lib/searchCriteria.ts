/**
 * What a driver is looking for, and how it survives a navigation.
 *
 * The search form and the results screen are two routes, so the criteria have
 * to cross a URL. They are encoded as plain query params rather than held in a
 * provider: a results screen is exactly the thing a driver reloads, shares or
 * lands on from history, and state kept in memory does not survive any of
 * those.
 */

export type SearchMode = "hourly" | "monthly";

/** Which days a monthly reservation covers. */
export type DayPattern = "everyday" | "weekdays" | "custom";

export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
export const WEEKDAYS = [1, 2, 3, 4, 5];

/**
 * The shortest stay worth selling. Below this the fee is smaller than the
 * cost of the driver walking to the spot.
 */
export const MIN_STAY_MINUTES = 15;

/** How far ahead either mode can be booked. */
export const MAX_DAYS_AHEAD = 60;

/** The longest single hourly stay. Anything longer is a monthly question. */
export const MAX_STAY_DAYS = 30;

export interface SearchPlace {
  latitude: number;
  longitude: number;
  /** What the driver picked, shown back to them so the search is legible. */
  label: string;
}

export interface HourlyCriteria {
  mode: "hourly";
  place: SearchPlace;
  /** Instants, so a device in another timezone still asks about the right moment. */
  from: string;
  to: string;
}

export interface MonthlyCriteria {
  mode: "monthly";
  place: SearchPlace;
  /** 0 = Sunday .. 6 = Saturday, matching JS getDay() and HostAvailability. */
  days: number[];
  /** The first day of the reservation, as YYYY-MM-DD. */
  startDate: string;
  startMinute: number;
  endMinute: number;
}

export type SearchCriteria = HourlyCriteria | MonthlyCriteria;

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
  const shared = {
    mode: criteria.mode,
    latitude: String(criteria.place.latitude),
    longitude: String(criteria.place.longitude),
    place: criteria.place.label,
  };

  if (criteria.mode === "hourly") {
    return { ...shared, from: criteria.from, to: criteria.to };
  }

  return {
    ...shared,
    days: criteria.days.join(","),
    startDate: criteria.startDate,
    startMinute: String(criteria.startMinute),
    endMinute: String(criteria.endMinute),
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

  if (read("mode") === "monthly") {
    const startDate = read("startDate");
    const days = (read("days") ?? "")
      .split(",")
      .map(Number)
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);

    const startMinute = Number(read("startMinute"));
    const endMinute = Number(read("endMinute"));

    if (
      !startDate ||
      days.length === 0 ||
      !Number.isFinite(startMinute) ||
      !Number.isFinite(endMinute) ||
      startMinute >= endMinute
    ) {
      return null;
    }

    return { mode: "monthly", place, days, startDate, startMinute, endMinute };
  }

  const from = read("from");
  const to = read("to");

  if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    return null;
  }

  if (Date.parse(to) - Date.parse(from) < MIN_STAY_MINUTES * 60_000) return null;

  return { mode: "hourly", place, from, to };
}

/** How the search reads back to the driver, on the results screen. */
export function describeCriteria(criteria: SearchCriteria): string {
  if (criteria.mode === "hourly") {
    const from = new Date(criteria.from);
    const to = new Date(criteria.to);
    const time = (date: Date) =>
      date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

    const sameDay = toDateKey(from) === toDateKey(to);

    return sameDay
      ? `${dayLabel(from)}, ${time(from)} – ${time(to)}`
      : `${dayLabel(from)} ${time(from)} – ${dayLabel(to)} ${time(to)}`;
  }

  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const pattern =
    criteria.days.length === 7
      ? "Every day"
      : criteria.days.join() === WEEKDAYS.join()
        ? "Mon–Fri"
        : criteria.days.map((day) => names[day]).join(", ");

  return `${pattern}, from ${dayLabel(fromDateKey(criteria.startDate))}`;
}
