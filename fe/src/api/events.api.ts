import type { EventDetail, EventFeedItem, Page } from "@/types/api.types";
import { request } from "./client";

export interface EventFilters {
  q?: string;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  cursor?: string;
  limit?: number;
}

/**
 * Only defined values become query parameters. Sending `latitude=undefined`
 * would fail validation at the API, which pairs latitude with longitude.
 */
function toQuery(filters: EventFilters): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

export const list = (token: string, filters: EventFilters = {}) =>
  request<Page<EventFeedItem>>(`/events${toQuery(filters)}`, { token });

export const getById = (token: string, id: string) =>
  request<EventDetail>(`/events/${id}`, { token });
