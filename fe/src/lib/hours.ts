import { formatMinute } from "@/components/ui";
import type { AvailabilityWindow } from "@/types/api.types";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Monday first: how a week is read here, and how a host thinks of one. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function describeWindow(window: Pick<AvailabilityWindow, "startMinute" | "endMinute">): string {
  if (window.startMinute === 0 && window.endMinute >= 1440) return "All day";
  return `${formatMinute(window.startMinute)} – ${formatMinute(window.endMinute)}`;
}

/**
 * The week as a few rows rather than seven.
 *
 * A spot open 7am-10pm every day is one fact, and listing it seven times
 * pushes everything below it a screen further down. Days with the same hours
 * are merged when they sit next to each other in the week, so a spot with
 * longer Saturdays still reads "Mon – Fri" then "Sat" then "Sun" -- never a
 * "Mon, Wed" that makes a driver check which days were skipped. A day with no
 * window is closed and simply absent.
 */
export function groupByHours(windows: AvailabilityWindow[]): { label: string; hours: string }[] {
  const hoursOn = (day: number) =>
    windows
      .filter((window) => window.dayOfWeek === day)
      .sort((a, b) => a.startMinute - b.startMinute)
      .map(describeWindow)
      .join(", ");

  const runs: { days: number[]; hours: string }[] = [];

  for (const day of WEEK_ORDER) {
    const hours = hoursOn(day);
    if (!hours) continue;

    const last = runs.at(-1);
    const previousDay = last?.days.at(-1);
    const adjacent = previousDay !== undefined && WEEK_ORDER.indexOf(day) === WEEK_ORDER.indexOf(previousDay) + 1;

    if (last && adjacent && last.hours === hours) last.days.push(day);
    else runs.push({ days: [day], hours });
  }

  return runs.map(({ days, hours }) => ({
    label:
      days.length === 7
        ? "Every day"
        : days.length === 1
          ? DAY_LABELS[days[0]]
          : `${DAY_LABELS[days[0]]} – ${DAY_LABELS[days.at(-1)!]}`,
    hours,
  }));
}
