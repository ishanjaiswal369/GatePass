import { VENUE_TIME_ZONE } from "./venue-time.js";

/**
 * Text the API composes for people to read -- inbox entries, mostly. In the
 * venue's time zone and the app's own formats, so an inbox line and the
 * screen it opens say the same thing.
 */

/** ₹83.60, ₹60, ₹1,200 -- the app's formatRupees, server side. */
export function rupees(amount: { toString(): string } | number): string {
  const value = Number(amount.toString());
  const [whole, paise] = value.toFixed(2).split(".");
  const grouped = Number(whole).toLocaleString("en-IN");
  return `₹${grouped}${paise === "00" ? "" : `.${paise}`}`;
}

/** 4:30 PM */
export function clock(at: Date): string {
  return at.toLocaleTimeString("en-IN", { timeZone: VENUE_TIME_ZONE, hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Thu, 24 Sep. Built by hand: ICU's en-IN short month is "Sept", which is
 * not how the app writes it.
 */
export function day(at: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: VENUE_TIME_ZONE, weekday: "short", day: "numeric", month: "numeric" })
      .formatToParts(at)
      .map((part) => [part.type, part.value])
  );
  return `${parts.weekday}, ${parts.day} ${MONTHS[Number(parts.month) - 1]}`;
}

/** GP-5B693D: the booking reference drivers and support quote. Mirrors the app's bookingRef. */
export function bookingRef(id: string): string {
  return `GP-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}
