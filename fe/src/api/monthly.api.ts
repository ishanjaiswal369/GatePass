import type { VehicleType } from "@/constants/enums";
import type { MonthlyCancellationQuote, MonthlyQuote, MonthlyReservation } from "@/types/api.types";
import { request } from "./client";

export interface TermInput {
  vehicleType: VehicleType;
  startDate: string;
  months: number;
  days: number[];
  startMinute: number;
  endMinute: number;
}

/** The whole term's price and whether every occurrence is free -- what the checkout shows. */
export const quote = (token: string, listingId: string, term: TermInput) => {
  const params = new URLSearchParams({
    vehicleType: term.vehicleType,
    startDate: term.startDate,
    months: String(term.months),
    days: term.days.join(","),
    startMinute: String(term.startMinute),
    endMinute: String(term.endMinute),
  });
  return request<MonthlyQuote>(`/spots/${listingId}/monthly-quote?${params}`, { token });
};

/** Holds the term for 15 minutes; payment (lib/payments) confirms it. Price and end date are the API's. */
export const reserve = (
  token: string,
  input: TermInput & { listingId: string; vehicleNumber: string; idempotencyKey: string }
) =>
  request<{ reservation: MonthlyReservation; replayed: boolean }>("/monthly-reservations", {
    method: "POST",
    body: input,
    token,
  });

export const list = (token: string, scope: "current" | "past") =>
  request<{ items: MonthlyReservation[] }>(`/monthly-reservations?scope=${scope}`, { token });

export const get = (token: string, id: string) => request<MonthlyReservation>(`/monthly-reservations/${id}`, { token });

export const cancellation = (token: string, id: string) =>
  request<MonthlyCancellationQuote>(`/monthly-reservations/${id}/cancellation`, { token });

export const cancel = (token: string, id: string, reason?: string) =>
  request<MonthlyReservation>(`/monthly-reservations/${id}/cancel`, { method: "POST", body: reason ? { reason } : {}, token });
