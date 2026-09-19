import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Small key/value store that works on both targets.
 *
 * Native uses expo-secure-store (Keychain on iOS, encrypted SharedPreferences
 * on Android). SecureStore has no web implementation, so the browser falls
 * back to localStorage.
 *
 * Every call is wrapped: a private window, cleared site data, or a device with
 * no keychain all throw or return null, and none of those should stop the app
 * from starting.
 */

export async function getItem(key: string): Promise<string | null> {
  try {
    if (Platform.OS === "web") {
      return globalThis.localStorage?.getItem(key) ?? null;
    }
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  try {
    if (Platform.OS === "web") {
      globalThis.localStorage?.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  } catch {
    // Not fatal -- the value simply does not survive this launch.
  }
}

export async function removeItem(key: string): Promise<void> {
  try {
    if (Platform.OS === "web") {
      globalThis.localStorage?.removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Nothing to do; callers clear their in-memory copy either way.
  }
}
