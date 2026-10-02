import * as Crypto from "expo-crypto";

/**
 * Random hex from the platform's secure generator.
 *
 * For ids that should not be guessable or collide: the installation's device
 * id, a booking's idempotency key. Math.random is neither -- its output can
 * be predicted, and two phones can produce the same short string.
 *
 * getRandomBytes rather than randomUUID: on the web the latter only exists
 * on https or localhost, and the app is also opened from a LAN address.
 */
export function randomId(bytes = 16): string {
  return Array.from(Crypto.getRandomBytes(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
