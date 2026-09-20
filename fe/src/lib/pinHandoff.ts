import type { AddressParts } from "@/types/api.types";

export interface PinnedPoint {
  latitude: number;
  longitude: number;
  /**
   * The address the map screen found at that point, when it found one.
   *
   * Carried with the pin rather than looked up again by the form: the map
   * screen already showed it to the host and they pressed save on it, so
   * re-resolving would both cost a second lookup and risk filling the fields
   * with something other than what they agreed to.
   */
  address?: AddressParts;
}

/**
 * The point the map screen hands back to the address form.
 *
 * A module-level holder rather than route params, because the form has typed
 * fields the host has not finished with. Coming back through the router with
 * new params would remount the form and lose them; this leaves the form on the
 * stack exactly as it was and only delivers the coordinates.
 *
 * Deliberately not a store for anything else: one value, set by one screen,
 * read once by the screen that opened it.
 */
let pending: PinnedPoint | null = null;
const listeners = new Set<(point: PinnedPoint) => void>();

export function deliverPin(point: PinnedPoint): void {
  pending = point;
  for (const listener of listeners) listener(point);
}

/** Takes the pending point, if any, and clears it. */
export function takePin(): PinnedPoint | null {
  const point = pending;
  pending = null;
  return point;
}

export function onPin(listener: (point: PinnedPoint) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
