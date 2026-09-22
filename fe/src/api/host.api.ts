import type { HostAvailabilityRow } from "@/types/api.types";
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
