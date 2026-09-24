import type {
  BookingDetail,
  BookingRow,
  CancellationQuote,
  ExtensionOptions,
  GatePassResult,
  Page,
  VehicleType,
} from "@/types/api.types";
import { request } from "./client";

export const list = (
  token: string,
  scope: "upcoming" | "active" | "past" = "upcoming",
  cursor?: string
) =>
  request<Page<BookingRow>>(
    `/bookings?scope=${scope}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    { token }
  );

/** 200 with `booking: null` is the normal "not parked" answer, not an error. */
export const active = (token: string) =>
  request<{ booking: BookingRow | null }>("/bookings/active", { token });

export const getPass = (token: string, bookingId: string) =>
  request<GatePassResult>(`/bookings/${bookingId}/pass`, { token });

/**
 * The key makes a retry after a dropped response resolve to the same booking
 * instead of a second one, so it is generated once per attempt by the caller
 * and reused across retries -- never regenerated inside this function.
 */
export const create = (
  token: string,
  input: {
    parkingCapacityId: string;
    vehicleNumber: string;
    quantity: number;
    idempotencyKey: string;
  }
) => request<BookingRow>("/bookings", { method: "POST", body: input, token });

/**
 * Books a host's spot for a stretch of time.
 *
 * Separate from `create` because it claims a range on a listing rather than
 * slots from a capacity, and is priced from an hourly rate. The key is
 * generated once per attempt by the caller and reused across retries, so a
 * dropped response resolves to the same booking rather than a second one.
 */
export const createSpotBooking = (
  token: string,
  input: {
    listingId: string;
    vehicleType: VehicleType;
    vehicleNumber: string;
    startsAt: string;
    endsAt: string;
    idempotencyKey: string;
  }
) => request<BookingRow>("/spot-bookings", { method: "POST", body: input, token });

/** One booking; `access` is filled in only once it is paid. */
export const get = (token: string, bookingId: string) =>
  request<BookingDetail>(`/bookings/${bookingId}`, { token });

/**
 * What cancelling now would give back. Asked before the driver commits, and
 * computed by the same policy the cancellation itself applies.
 */
export const cancellation = (token: string, bookingId: string) =>
  request<CancellationQuote>(`/bookings/${bookingId}/cancellation`, { token });

/** Safe to repeat: a second call returns the already-cancelled booking. */
export const cancel = (token: string, bookingId: string, reason?: string) =>
  request<BookingDetail>(`/bookings/${bookingId}/cancel`, {
    method: "POST",
    body: reason ? { reason } : {},
    token,
  });

export const extensionOptions = (token: string, bookingId: string) =>
  request<ExtensionOptions>(`/bookings/${bookingId}/extensions`, { token });

/**
 * Holds extra time on a running stay, for the driver to pay for. As with a
 * booking, the key is generated once per attempt and reused on retry.
 */
export const createExtension = (
  token: string,
  bookingId: string,
  input: { minutes: number; idempotencyKey: string }
) =>
  request<{ extensionId: string; booking: BookingDetail }>(
    `/bookings/${bookingId}/extensions`,
    { method: "POST", body: input, token }
  );
