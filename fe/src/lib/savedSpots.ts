/**
 * Hearts changed on a spot's own screen, for the list the driver goes back to.
 *
 * The results list used to learn about them by running its whole search
 * again on every return. The search is the heaviest request the app makes and
 * its answer hasn't changed in the few seconds a driver spent looking at one
 * spot; the only thing that has is whether that spot is saved. So the spot's
 * screen notes it here, and the list picks it up when it regains focus.
 *
 * In memory only: a list that isn't mounted reads the server's own answer
 * when it next searches.
 */

const changed = new Map<string, boolean>();

export function rememberSaved(spotId: string, saved: boolean): void {
  changed.set(spotId, saved);
}

/** What changed since the last call. Taken, not peeked: each change is applied once. */
export function takeSavedChanges(): Map<string, boolean> {
  const taken = new Map(changed);
  changed.clear();
  return taken;
}
