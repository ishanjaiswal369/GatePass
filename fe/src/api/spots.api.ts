import type { Amenity, VehicleType } from "@/constants/enums";
import type {
  GeocodeResult,
  PlaceSuggestion,
  NearbySpot,
  PublicSpot,
  RatingSummary,
  SavedSpot,
  SpaceType,
  SpotReview,
  StayQuote,
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
    /** Monthly: the term, so the API checks every occurrence, not just the first week. */
    startDate?: string;
    months?: number;
    /** Prices the cards for this vehicle, and hides spots that don't take it. */
    vehicleType?: VehicleType;
    amenities?: Amenity[];
    spaceTypes?: SpaceType[];
    maxPricePerHour?: number;
    open24x7?: boolean;
    minRating?: number;
    sort?: "distance" | "price";
    /** At most this many; the API caps it at 50. */
    limit?: number;
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
    if (input.startDate) params.set("startDate", input.startDate);
    if (input.months) params.set("months", String(input.months));
  }
  if (input.vehicleType) params.set("vehicleType", input.vehicleType);
  if (input.amenities?.length) params.set("amenities", input.amenities.join(","));
  if (input.spaceTypes?.length) params.set("spaceTypes", input.spaceTypes.join(","));
  if (input.maxPricePerHour !== undefined) params.set("maxPricePerHour", String(input.maxPricePerHour));
  if (input.open24x7) params.set("open24x7", "true");
  if (input.minRating !== undefined) params.set("minRating", String(input.minRating));
  if (input.sort) params.set("sort", input.sort);
  if (input.limit !== undefined) params.set("limit", String(input.limit));

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

/**
 * The price of one stay, and whether it can be had -- from the same function
 * the booking charges with, so the checkout never shows an estimate.
 */
export const quote = (
  token: string,
  id: string,
  input: { vehicleType: VehicleType; startsAt: string; endsAt: string }
) =>
  request<StayQuote>(`/spots/${id}/quote?${new URLSearchParams(input)}`, { token });

export const saved = (token: string) =>
  request<{ spots: SavedSpot[] }>("/favorites", { token });

/** Idempotent both ways: a double tap on the heart lands in the same state. */
export const save = (token: string, id: string) =>
  request<{ saved: true }>(`/favorites/${id}`, { method: "PUT", token });

export const unsave = (token: string, id: string) =>
  request<{ saved: false }>(`/favorites/${id}`, { method: "DELETE", token });

export type ReviewStarsFilter = "5" | "4" | "low";

/**
 * Every review of a spot, newest first, optionally only 5, only 4, or 3 and
 * below. Only the first page carries the summary, which always covers all.
 */
export const reviews = (token: string, id: string, options: { cursor?: string; stars?: ReviewStarsFilter } = {}) => {
  const params = new URLSearchParams();
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.stars) params.set("stars", options.stars);
  const query = params.toString();
  return request<{
    items: SpotReview[];
    nextCursor: string | null;
    summary: RatingSummary | null;
    spot: { id: string; name: string };
  }>(`/spots/${id}/reviews${query ? `?${query}` : ""}`, { token });
};
