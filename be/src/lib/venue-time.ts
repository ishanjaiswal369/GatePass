/**
 * Times of day at the venue, for code that has to compare an instant against
 * a weekly schedule.
 *
 * `HostAvailability` stores "Tuesdays, 540 to 1080" -- a weekday and two
 * minute counts, with no timezone, because a time of day does not have one.
 * Turning a booking's instants into that shape is the only place the two
 * meet, so the conversion lives here rather than being repeated by every
 * caller with its own idea of which clock to read.
 */

/**
 * Every venue and every host in this product is in one country, so a window
 * stored as "18:00 on a Tuesday" means 18:00 IST. Hard-coding it is honest
 * for a single-market app and cheaper than a per-listing timezone column that
 * would hold the same value on every row; it becomes wrong the day the
 * product crosses a timezone, which is the point to revisit it.
 */
export const VENUE_TIME_ZONE = "Asia/Kolkata";

export const MINUTES_IN_DAY = 24 * 60;

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Weekday and minute-of-day at the venue, for an instant.
 *
 * Read through Intl rather than the server's own clock: a container running
 * in UTC reports 22:30 IST as the previous day, which would silently hide
 * every evening window.
 */
export function venueDayAndMinute(at: Date): {
  dayOfWeek: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: VENUE_TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);

  const lookup = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  // Intl can return "24" for midnight with hour12: false.
  const hour = Number(lookup("hour")) % 24;

  return {
    dayOfWeek: Math.max(DAY_NAMES.indexOf(lookup("weekday")), 0),
    minute: hour * 60 + Number(lookup("minute")),
  };
}

export interface DaySegment {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

/**
 * Splits a stay into one piece per venue-local day.
 *
 * A booking from 22:00 to 02:00 is two questions, not one: is the spot open
 * late on Tuesday, and is it open early on Wednesday. Asked as a single
 * 22:00-26:00 range it can never match anything, because a window's end is
 * capped at midnight -- which is exactly why an overnight stay silently found
 * nothing before this existed.
 *
 * A segment that would be empty (a stay ending exactly at midnight) is not
 * emitted, so "open until 24:00" covers it without also requiring the next
 * day to be open.
 */
export function daySegments(start: Date, end: Date): DaySegment[] {
  const segments: DaySegment[] = [];
  let cursor = start;

  // A stay is capped well below this by the request layer; the bound is here
  // so a bad pair of dates cannot spin rather than fail.
  for (let guard = 0; guard < 400 && cursor < end; guard += 1) {
    const { dayOfWeek, minute } = venueDayAndMinute(cursor);
    const remaining = Math.round((end.getTime() - cursor.getTime()) / 60_000);
    const untilMidnight = MINUTES_IN_DAY - minute;
    const take = Math.min(remaining, untilMidnight);

    segments.push({
      dayOfWeek,
      startMinute: minute,
      endMinute: minute + take,
    });

    cursor = new Date(cursor.getTime() + take * 60_000);
  }

  return segments;
}
