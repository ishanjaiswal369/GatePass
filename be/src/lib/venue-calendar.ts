import { VENUE_TIME_ZONE } from "./venue-time.js";

/**
 * Venue-local calendar days as instants. IST has no daylight saving, so a
 * local midnight is always 18:30 UTC the day before; the offset is fixed on
 * purpose and checked against the zone name so a change of venue can't
 * silently keep it.
 */
const IST_OFFSET_MS = 330 * 60_000;
if (VENUE_TIME_ZONE !== "Asia/Kolkata") throw new Error("venue-calendar assumes IST (+05:30)");

/** "2026-09-24" in the venue's zone. */
export function venueDate(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Local midnight at the start of that date, as an instant. */
export function startOfVenueDay(date: string): Date {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) - IST_OFFSET_MS);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** 0 = Sunday, like HostAvailability. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

/** The first instant of the venue-local month containing `at`. */
export function startOfVenueMonth(at: Date): Date {
  return startOfVenueDay(`${venueDate(at).slice(0, 7)}-01`);
}
