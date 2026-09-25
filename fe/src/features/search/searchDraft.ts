import {
  MAX_DAYS_AHEAD,
  addDays,
  atMinute,
  toDateKey,
  type SearchPlace,
} from "@/lib/searchCriteria";
import { getItem, removeItem, setItem } from "@/lib/storage";

/**
 * What the driver has filled into the search form but not searched yet.
 *
 * The form used to hold all of this in its own state, so anything that
 * unmounted it threw it away: switching to "Already parked" and back, a
 * bottom-nav round trip (which pushes a fresh home screen), or a reload. The
 * place is the part that hurts -- it is the one thing typed rather than
 * tapped -- but losing a carefully picked Saturday afternoon is no better.
 *
 * Two layers. A module-level copy, read synchronously, so a remount starts
 * from the draft instead of flashing defaults first. And the device store
 * behind it, so a reload or a relaunch still has it; that read is async, so
 * the form picks it up a moment after mounting.
 */

const KEY = "gatepass.searchDraft";

export interface SearchDraft {
  place: SearchPlace | null;
  fromDate: string;
  fromMinute: number;
  toDate: string;
  toMinute: number;
}

let cached: SearchDraft | null = null;
let loading: Promise<SearchDraft | null> | null = null;

/** The draft already in memory, if this launch has one. */
export function peekDraft(): SearchDraft | null {
  return cached;
}

/** The stored draft, read once per launch however many forms ask. */
export function loadDraft(): Promise<SearchDraft | null> {
  loading ??= (async () => {
    if (cached) return cached;

    const raw = await getItem(KEY);
    if (!raw) return null;

    try {
      const parsed = readShape(JSON.parse(raw));
      // A form that mounted and was edited before the read finished wins:
      // what the driver just did is newer than anything on disk.
      if (parsed && !cached) cached = parsed;
      return cached;
    } catch {
      return null;
    }
  })();

  return loading;
}

export function saveDraft(draft: SearchDraft): void {
  cached = draft;
  void setItem(KEY, JSON.stringify(draft));
}

/**
 * Forgets it, on sign-out. Where someone looks for parking is theirs, and on
 * a shared phone the next person to sign in should not be offered it.
 */
export async function clearDraft(): Promise<void> {
  cached = null;
  loading = null;
  await removeItem(KEY);
}

/**
 * A draft made usable against the clock as it is now.
 *
 * The place carries over as it is. Times only carry over while they are
 * still bookable: a draft from yesterday afternoon would otherwise offer an
 * arrival in the past, or a date the day pickers no longer list and so would
 * show as a blank.
 */
export function freshen(
  draft: SearchDraft,
  defaults: SearchDraft,
  now: Date
): SearchDraft {
  const first = toDateKey(now);
  const last = toDateKey(addDays(now, MAX_DAYS_AHEAD - 1));
  const listed = (key: string) => key >= first && key <= last;

  const hourlyOk =
    listed(draft.fromDate) &&
    listed(draft.toDate) &&
    atMinute(draft.fromDate, draft.fromMinute).getTime() > now.getTime() &&
    atMinute(draft.toDate, draft.toMinute).getTime() >
      atMinute(draft.fromDate, draft.fromMinute).getTime();

  return {
    place: draft.place,
    ...(hourlyOk
      ? {
          fromDate: draft.fromDate,
          fromMinute: draft.fromMinute,
          toDate: draft.toDate,
          toMinute: draft.toMinute,
        }
      : {
          fromDate: defaults.fromDate,
          fromMinute: defaults.fromMinute,
          toDate: defaults.toDate,
          toMinute: defaults.toMinute,
        }),
  };
}

/**
 * Null for anything that is not a draft this version wrote. The store
 * outlives app updates, and a field renamed since would otherwise arrive as
 * `undefined` and render as a broken picker.
 */
function readShape(value: unknown): SearchDraft | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;

  const isMinute = (n: unknown) =>
    typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 24 * 60;
  const isDateKey = (s: unknown) =>
    typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

  const place = v.place as Record<string, unknown> | null;
  const placeOk =
    place === null ||
    (typeof place === "object" &&
      typeof place.latitude === "number" &&
      typeof place.longitude === "number" &&
      typeof place.label === "string");

  if (
    !placeOk ||
    !isDateKey(v.fromDate) ||
    !isDateKey(v.toDate) ||
    !isMinute(v.fromMinute) ||
    !isMinute(v.toMinute)
  ) {
    return null;
  }

  // Only the fields this version reads, so nothing else a draft carries
  // travels back into the form.
  return {
    place: place as SearchPlace | null,
    fromDate: v.fromDate as string,
    fromMinute: v.fromMinute as number,
    toDate: v.toDate as string,
    toMinute: v.toMinute as number,
  };
}
