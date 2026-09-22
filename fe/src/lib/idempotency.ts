/**
 * Keys that make a retry resolve to the booking the first attempt created.
 *
 * The key identifies one *intent*, not one screen and not one tap. Generating
 * it per tap means a retry after a dropped response books twice; generating it
 * once per screen means a driver who changes the vehicle and books again is
 * handed back the booking they just abandoned. So it is held against a
 * signature of everything that decides what gets booked, and only a change
 * there earns a new key.
 */

/** ~60 bits of randomness, well inside the API's 8..128 characters. */
function randomKey(): string {
  const chunk = () => Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${chunk()}${chunk()}`;
}

export interface Attempt {
  signature: string;
  key: string;
}

/**
 * The key for this signature, minting one only when the signature has moved.
 * Callers keep the `Attempt` in a ref, so it survives re-renders but not a
 * fresh visit to the screen -- which is a new intent anyway.
 */
export function keyFor(
  held: { current: Attempt | null },
  signature: string
): string {
  if (held.current?.signature !== signature) {
    held.current = { signature, key: randomKey() };
  }

  return held.current.key;
}
