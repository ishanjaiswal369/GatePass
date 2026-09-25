import type {
  CalendarBlock,
  HostAvailabilityRow,
  HostBooking,
  HostCalendar,
  HostEarnings,
  HostOverview,
  HostSummary,
} from "@/types/api.types";
import { request } from "./client";

/**
 * A host's availability windows, one at a time.
 *
 * Reading them has no call here: `/host/spots` carries each spot's own
 * windows, so the dashboard gets the whole picture in the request it was
 * already making. This is only for changing one.
 *
 * There is no "become a host" call either -- `spotListingApi.create` makes
 * the caller one as a side effect of naming their first spot, so there is no
 * state between "not a host" and "a host with a named spot".
 */
export const setAvailabilityActive = (
  token: string,
  id: string,
  isActive: boolean
) =>
  request<HostAvailabilityRow>(`/host/availability/${id}`, {
    method: "PATCH",
    body: { isActive },
    token,
  });

// ---------- Running a space (Phase 5) ----------

export const summary = (token: string) => request<HostSummary>("/host/summary", { token });

export const overview = (token: string, id: string) => request<HostOverview>(`/host/spots/${id}/overview`, { token });

/** Paused: out of search, no new bookings; existing ones are untouched. */
export const setPaused = (token: string, id: string, paused: boolean) =>
  request<{ paused: boolean }>(`/host/spots/${id}/pause`, { method: "PATCH", body: { paused }, token });

export type HostBookingScope = "upcoming" | "active" | "completed" | "cancelled";

export const bookings = (token: string, scope: HostBookingScope, listingId?: string) =>
  request<{ items: HostBooking[] }>(
    `/host/bookings?scope=${scope}${listingId ? `&listingId=${listingId}` : ""}`,
    { token }
  );

export const calendar = (token: string, id: string, from: string, days = 7) =>
  request<HostCalendar>(`/host/spots/${id}/calendar?from=${from}&days=${days}`, { token });

export type BlockInput =
  | { kind: "range"; startsAt: string; endsAt: string; reason?: string }
  | { kind: "day"; date: string; freeOnly?: boolean; reason?: string };

/** 409 over a booking, with `booking` naming it -- the screen offers "free hours only". */
export const block = (token: string, id: string, input: BlockInput) =>
  request<{ blocks: CalendarBlock[] }>(`/host/spots/${id}/blocks`, { method: "POST", body: input, token });

export const unblock = (token: string, id: string, blockId: string) =>
  request<{ removed: true }>(`/host/spots/${id}/blocks/${blockId}`, { method: "DELETE", token });

export const earnings = (token: string) => request<HostEarnings>("/host/earnings", { token });
