import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const KEY = "gatepass.session";

/**
 * Where the session token is kept between launches.
 *
 * Native uses expo-secure-store, which is the Keychain on iOS and encrypted
 * SharedPreferences on Android. SecureStore has no web implementation, so the
 * browser falls back to localStorage -- readable by any script on the origin,
 * which is the accepted cost of a refresh not signing you out. It is the same
 * exposure every token-in-the-browser app carries; the mitigation is the
 * token's expiry and server-side session revocation, not the storage.
 *
 * Every call is wrapped: a private window, cleared site data or a device with
 * no keychain all throw or return null, and none of those should stop the app
 * from starting at the sign-in screen.
 */

interface StoredSession {
  token: string;
}

export async function saveSession(token: string): Promise<void> {
  const payload = JSON.stringify({ token } satisfies StoredSession);

  try {
    if (Platform.OS === "web") {
      globalThis.localStorage?.setItem(KEY, payload);
      return;
    }
    await SecureStore.setItemAsync(KEY, payload);
  } catch {
    // Not fatal: the user stays signed in for this launch and signs in again
    // next time, which beats refusing to proceed.
  }
}

export async function loadSession(): Promise<string | null> {
  try {
    const raw =
      Platform.OS === "web"
        ? globalThis.localStorage?.getItem(KEY) ?? null
        : await SecureStore.getItemAsync(KEY);

    if (!raw) return null;

    const parsed = JSON.parse(raw) as StoredSession;
    return typeof parsed.token === "string" ? parsed.token : null;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    if (Platform.OS === "web") {
      globalThis.localStorage?.removeItem(KEY);
      return;
    }
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Nothing to do; the in-memory session is cleared by the caller either way.
  }
}
