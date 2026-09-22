import type {
  BookingRow,
  GatePassResult,
  Page,
  VehicleType,
} from "@/types/api.types";
import { request } from "./client";

export const list = (
  token: string,
  scope: "upcoming" | "past" = "upcoming",
  cursor?: string
) =>
  request<Page<BookingRow>>(
    `/bookings?scope=${scope}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    { token }
  );

/** 200 with `booking: null` is the normal "no pass yet" answer, not an error. */
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
