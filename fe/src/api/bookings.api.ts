import type { BookingRow, GatePassResult, Page } from "@/types/api.types";
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
