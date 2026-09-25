import type { ChipTone } from "@/components/ui";
import type { MonthlyPhase, MonthlyReservation } from "@/types/api.types";
import { fromDateKey } from "./searchCriteria";

/**
 * Reading a monthly term the way the prototype prints it:
 * "1 Oct – 31 Dec 2026 · 3 months", "Mon–Fri · 9:00 AM – 7:00 PM".
 *
 * Dates arrive as venue-calendar days ("YYYY-MM-DD"), not instants, so they
 * are read as local dates and never shifted by a timezone.
 */

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Monday first, as a week is read here. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** "Every day", "Mon–Fri", "Mon–Sat", or "Mon, Wed, Fri" when the days aren't a run. */
export function termDays(days: number[]): string {
  if (days.length === 7) return "Every day";
  const ordered = WEEK_ORDER.filter((day) => days.includes(day));
  const positions = ordered.map((day) => WEEK_ORDER.indexOf(day));
  const run = positions.every((p, i) => i === 0 || p === positions[i - 1] + 1);
  if (run && ordered.length >= 3) return `${DAY_NAMES[ordered[0]]}–${DAY_NAMES[ordered.at(-1)!]}`;
  return ordered.map((day) => DAY_NAMES[day]).join(", ");
}

/** A minute of the day as "9:00 AM"; 1440 is midnight at the end of the day. */
export function clockMinute(minute: number): string {
  const m = minute % 1440;
  const hours = Math.floor(m / 60);
  const suffix = hours < 12 ? "AM" : "PM";
  return `${hours % 12 === 0 ? 12 : hours % 12}:${String(m % 60).padStart(2, "0")} ${suffix}`;
}

export function termHours(startMinute: number, endMinute: number): string {
  return `${clockMinute(startMinute)} – ${clockMinute(endMinute)}`;
}

function shortDate(key: string, withYear: boolean): string {
  const date = fromDateKey(key);
  const month = date.toLocaleDateString("en-GB", { month: "short" }).replace("Sept", "Sep");
  return `${date.getDate()} ${month}${withYear ? ` ${date.getFullYear()}` : ""}`;
}

/** "1 Oct" -- the day a term starts, for the cancellation copy. */
export function termDay(key: string): string {
  return shortDate(key, false);
}

export function monthsLabel(months: number): string {
  return `${months} ${months === 1 ? "month" : "months"}`;
}

/** "1 Oct – 31 Dec 2026 · 3 months"; both years when the term crosses one. */
export function termRange(startDate: string, lastDate: string, months: number): string {
  const sameYear = startDate.slice(0, 4) === lastDate.slice(0, 4);
  return `${shortDate(startDate, !sameYear)} – ${shortDate(lastDate, true)} · ${monthsLabel(months)}`;
}

export function termSchedule(term: { days: number[]; startMinute: number; endMinute: number }): string {
  return `${termDays(term.days)} · ${termHours(term.startMinute, term.endMinute)}`;
}

const PHASES: Record<MonthlyPhase, { label: string; tone: ChipTone }> = {
  PENDING: { label: "Awaiting payment", tone: "warning" },
  EXPIRED: { label: "Hold expired", tone: "neutral" },
  UPCOMING: { label: "Confirmed", tone: "success" },
  ACTIVE: { label: "Active", tone: "success" },
  COMPLETED: { label: "Completed", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export function monthlyChip(phase: MonthlyPhase): { label: string; tone: ChipTone } {
  return PHASES[phase];
}

/** What the driver pays: parking for the whole term, the fee and GST on it. */
export function monthlyTotal(row: Pick<MonthlyReservation, "amount" | "platformFee" | "taxAmount">): string {
  return (Number(row.amount) + Number(row.platformFee) + Number(row.taxAmount)).toFixed(2);
}
