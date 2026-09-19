import { getItem, setItem } from "./storage";

const KEY = "gatepass.deviceId";

// The in-flight promise, not just the resolved value: two callers that both
// arrive before the first read finishes would otherwise each generate an id,
// each write it, and the API would open a session row for each. Memoising the
// promise means every caller awaits the same one.
let pending: Promise<string> | null = null;

/**
 * A stable id for this installation, so repeat logins reuse one UserSession
 * row instead of piling up.
 *
 * This used to read localStorage synchronously, which does not exist on native
 * -- so every app launch fell through to a fresh random id and the API opened
 * another session row. A phone would have accumulated one row per launch
 * forever, and the user's "Devices" list would be unusable.
 *
 * Reading the real store is async, so this is a function rather than a const,
 * memoised because it is called on every auth request.
 */
export function getDeviceId(): Promise<string> {
  pending ??= (async () => {
    const saved = await getItem(KEY);
    if (saved) return saved;

    const fresh = `dev-${Math.random().toString(36).slice(2, 10)}`;
    await setItem(KEY, fresh);
    return fresh;
  })();

  return pending;
}
