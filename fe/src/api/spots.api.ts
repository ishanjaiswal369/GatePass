import type { GeocodeResult, NearbySpot } from "@/types/api.types";
import { request } from "./client";

export const nearby = (
  token: string,
  input: { latitude: number; longitude: number; radiusKm?: number }
) =>
  request<{ spots: NearbySpot[] }>(
    `/spots/nearby?latitude=${input.latitude}&longitude=${input.longitude}` +
      `&radiusKm=${input.radiusKm ?? 5}`,
    { token }
  );

/**
 * Place search for typing an area by hand. Answers 503 when no provider is
 * configured -- callers show that as "unavailable", not as a failure.
 */
export const geocode = (token: string, q: string) =>
  request<{ results: GeocodeResult[]; provider: string }>(
    `/geocode?q=${encodeURIComponent(q)}`,
    { token }
  );
