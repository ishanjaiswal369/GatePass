import type { HostAvailabilityRow, HostProfile } from "@/types/api.types";
import { request } from "./client";

/** `profile: null` means "not a host yet", which is the common case. */
export const getProfile = (token: string) =>
  request<{ profile: HostProfile | null }>("/host/profile", { token });

/**
 * Onboarding. `spotId` is the listing created alongside the profile in the
 * same transaction -- the caller (the wizard's address step) needs it to
 * carry the right id into the wizard's next screen.
 */
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
  request<{ profile: HostProfile; spotId: string }>("/host/profile", {
    method: "POST",
    body: input,
    token,
  });

/** Omit `listingId` for every window across all of a host's spots. */
export const listAvailability = (token: string, listingId?: string) =>
  request<{ availability: HostAvailabilityRow[] }>(
    `/host/availability${listingId ? `?listingId=${listingId}` : ""}`,
    { token }
  );

export const addAvailability = (
  token: string,
  input: {
    listingId: string;
    dayOfWeek: number;
    startMinute: number;
    endMinute: number;
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
