import type {
  GeocodeResult,
  PlaceSuggestion,
  NearbySpot,
  PublicSpot,
} from "@/types/api.types";
import { request } from "./client";

/**
 * Spots bookable around a point.
 *
 * Two shapes of question through one endpoint. `at` + `durationMinutes` asks
 * about one stay; `days` + `startMinute` + `endMinute` asks about a recurring
 * one, and only returns spots open across that range on *every* listed day.
 */
export const nearby = (
  token: string,
  input: {
    latitude: number;
    longitude: number;
    radiusKm?: number;
    at?: string;
    durationMinutes?: number;
    days?: number[];
    startMinute?: number;
    endMinute?: number;
  }
) => {
  const params = new URLSearchParams({
    latitude: String(input.latitude),
    longitude: String(input.longitude),
    radiusKm: String(input.radiusKm ?? 5),
  });

  if (input.at) params.set("at", input.at);
  if (input.durationMinutes !== undefined) {
    params.set("durationMinutes", String(input.durationMinutes));
  }
  if (input.days?.length) {
    params.set("days", input.days.join(","));
    params.set("startMinute", String(input.startMinute));
    params.set("endMinute", String(input.endMinute));
  }

  return request<{ spots: NearbySpot[] }>(`/spots/nearby?${params}`, { token });
};

/**
 * Place search for typing an area by hand. Answers 503 when no provider is
 * configured -- callers show that as "unavailable", not as a failure.
 */
export const geocode = (token: string, q: string) =>
  request<{ results: GeocodeResult[]; provider: string }>(
    `/geocode?q=${encodeURIComponent(q)}`,
    { token }
  );

/**
 * Type-ahead suggestions. May come back without coordinates: the better
 * autocomplete APIs answer with a place id and a label, and charge for the
 * coordinates separately -- see placeDetails.
 */
export const autocomplete = (
  token: string,
  q: string,
  options: { sessionToken?: string } = {}
) => {
  const params = new URLSearchParams({ q });
  if (options.sessionToken) params.set("sessionToken", options.sessionToken);

  return request<{ suggestions: PlaceSuggestion[] }>(
    `/geocode/autocomplete?${params}`,
    { token }
  );
};

/**
 * The address at a point.
 *
 * The other direction from geocode(): the map gives coordinates, and this is
 * what turns them into something a host can read and a driver can follow.
 * Answers 404 when the provider has nothing there, which is a valid pin with
 * no name rather than a failure.
 */
export const reverseGeocode = (
  token: string,
  latitude: number,
  longitude: number
) =>
  request<{ result: GeocodeResult }>(
    `/geocode/reverse?latitude=${latitude}&longitude=${longitude}`,
    { token }
  );

/** Coordinates for the one suggestion the host actually picked. */
export const placeDetails = (
  token: string,
  placeId: string,
  options: { sessionToken?: string } = {}
) => {
  const params = new URLSearchParams();
  if (options.sessionToken) params.set("sessionToken", options.sessionToken);
  const query = params.toString();

  return request<{ result: GeocodeResult }>(
    `/geocode/place/${encodeURIComponent(placeId)}${query ? `?${query}` : ""}`,
    { token }
  );
};

/**
 * One spot, for a driver deciding whether to book it.
 *
 * `/events/:id` cannot answer this -- it excludes INDEPENDENT_SPOT by design
 * -- so host spots have their own read. Access instructions are not in it:
 * those arrive with a paid booking.
 */
export const getById = (token: string, id: string) =>
  request<PublicSpot>(`/spots/${id}`, { token });
