import { profileApi } from "@/api";
import type { Vehicle } from "@/types/api.types";

/**
 * The driver's saved vehicles, read once and shared.
 *
 * One booking walks through the search form, the results, the spot and the
 * checkout, and each needs the vehicles: read separately that was four
 * identical requests in a row. Here the first read is kept for a minute and
 * the rest share it -- including two screens asking at the same moment, which
 * get the same promise rather than a request each.
 *
 * The vehicles screen is the only place the list changes. It reads with
 * `fresh` after every add, remove or change of default, which replaces what
 * is held, so a screen returned to afterwards sees the new list.
 *
 * Held against the session token: another account's sign-in never sees it.
 */

const FRESH_FOR_MS = 60_000;

let held: { token: string; at: number; pending: Promise<Vehicle[]> } | null = null;

export function loadVehicles(token: string, options: { fresh?: boolean } = {}): Promise<Vehicle[]> {
  if (!options.fresh && held && held.token === token && Date.now() - held.at < FRESH_FOR_MS) {
    return held.pending;
  }

  const pending = profileApi.listVehicles(token).then(({ vehicles }) => vehicles);
  held = { token, at: Date.now(), pending };
  // A failed read isn't kept: the next caller asks again.
  pending.catch(() => {
    if (held?.pending === pending) held = null;
  });
  return pending;
}
