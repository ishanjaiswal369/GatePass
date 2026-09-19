import type { HostAvailabilityRow, HostProfile } from "@/types/api.types";
import { request } from "./client";

/** `profile: null` means "not a host yet", which is the common case. */
export const getProfile = (token: string) =>
  request<{ profile: HostProfile | null }>("/host/profile", { token });

export const createProfile = (
  token: string,
  input: {
    addressLine: string;
    city: string;
    state: string;
    pincode: string;
    latitude: number;
    longitude: number;
    panNumber?: string;
    bankAccountId?: string;
  }
) =>
  request<{ profile: HostProfile }>("/host/profile", {
    method: "POST",
    body: input,
    token,
  });

export const listAvailability = (token: string) =>
  request<{ availability: HostAvailabilityRow[] }>("/host/availability", {
    token,
  });

export const addAvailability = (
  token: string,
  input: {
    dayOfWeek: number;
    startMinute: number;
    endMinute: number;
    pricePerHour: number;
  }
) =>
  request<HostAvailabilityRow>("/host/availability", {
    method: "POST",
    body: input,
    token,
  });

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
