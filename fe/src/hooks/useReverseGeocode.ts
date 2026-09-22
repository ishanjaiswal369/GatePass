import { useEffect, useRef, useState } from "react";
import { ApiError, spotsApi } from "@/api";
import type { AddressParts } from "@/types/api.types";

/**
 * How long the point has to stop moving before a lookup goes out.
 *
 * Every drag of the map settles on a new point, and a lookup per settle is a
 * billed geocode per nudge. Longer than the place-search debounce because
 * nudging a pin onto a gate is a slower action than typing, and nobody is
 * waiting on the answer to keep going -- the pin already works without it.
 */
const DEBOUNCE_MS = 600;

/** Below this the address cannot have changed, so the lookup is skipped. */
const SAME_POINT = 1e-6;

/**
 * The address at a point, looked up as the point settles.
 *
 * Coordinates are what a driver's maps app routes to, but they are not what a
 * host recognises or what a listing shows, so the two have to travel together.
 * The lookup is advisory: a failure leaves `address` null and changes nothing
 * else, because the pin on its own is still a complete answer to "where".
 */
export function useReverseGeocode(
  token: string | null,
  point: { latitude: number; longitude: number } | null
) {
  const [address, setAddress] = useState<AddressParts | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const latitude = point?.latitude;
  const longitude = point?.longitude;

  /** The point the newest request was made for, so stale answers are dropped. */
  const inFlightFor = useRef<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => {
    if (!token || latitude === undefined || longitude === undefined) {
      setAddress(null);
      setDescription(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(async () => {
      const asked = { latitude, longitude };
      inFlightFor.current = asked;

      try {
        const { result } = await spotsApi.reverseGeocode(
          token,
          latitude,
          longitude
        );

        // The pin moved on while this was in the air.
        if (cancelled || !isSame(inFlightFor.current, asked)) return;

        setAddress(result.address ?? null);
        setDescription(result.description || null);
        setFailed(false);
      } catch (error) {
        if (cancelled || !isSame(inFlightFor.current, asked)) return;

        // 404 is a real answer: the pin is valid, the provider just has no
        // address for that patch of ground. Anything else is a fault worth
        // logging, and neither is worth stopping the host over.
        if (!(error instanceof ApiError && error.status === 404)) {
          console.warn("reverse geocode failed", error);
          setFailed(true);
        }

        setAddress(null);
        setDescription(null);
      } finally {
        if (!cancelled && isSame(inFlightFor.current, asked)) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token, latitude, longitude]);

  return { address, description, loading, failed };
}

function isSame(
  a: { latitude: number; longitude: number } | null,
  b: { latitude: number; longitude: number }
): boolean {
  return (
    a !== null &&
    Math.abs(a.latitude - b.latitude) < SAME_POINT &&
    Math.abs(a.longitude - b.longitude) < SAME_POINT
  );
}
