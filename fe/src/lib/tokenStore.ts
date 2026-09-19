import { getItem, removeItem, setItem } from "./storage";

const KEY = "gatepass.session";

/**
 * Where the session token is kept between launches. See lib/storage for where
 * that actually lands on each platform.
 *
 * On web this is localStorage, readable by any script on the origin -- the
 * accepted cost of a refresh not signing you out. The mitigation is the
 * token's expiry and server-side session revocation, not the storage.
 */

interface StoredSession {
  token: string;
}

export async function saveSession(token: string): Promise<void> {
  await setItem(KEY, JSON.stringify({ token } satisfies StoredSession));
}

export async function loadSession(): Promise<string | null> {
  const raw = await getItem(KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as StoredSession;
    return typeof parsed.token === "string" ? parsed.token : null;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await removeItem(KEY);
}
