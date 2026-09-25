import type { Amenity, VehicleSize } from "@/constants/enums";
import type {
  EntryMethod,
  OutsideHours,
  OwnershipDocType,
  PayoutAccount,
  PermissionBasis,
  PresignedUpload,
  SpaceType,
  SpotListing,
  SpotReadiness,
  VehicleType,
} from "@/types/api.types";
import { request } from "./client";

/**
 * The host spot wizard.
 *
 * Every step is its own call against the same draft, so the server holds the
 * progress and a host who closes the app mid-way picks up where they were.
 * Nothing here keeps wizard state on the client. A host can have more than
 * one spot -- every call below is scoped to the specific `id` its caller
 * passes, never to "the" spot.
 */

/** The whole dashboard: every spot with its hours, and the payout gate. */
export const list = (token: string) =>
  request<{ spots: SpotListing[]; payout: PayoutAccount }>("/host/spots", {
    token,
  });

export const getById = (token: string, id: string) =>
  request<SpotListing>(`/host/spots/${id}`, { token });

/**
 * Opens the listing, named. Also makes the caller a host if they were not one
 * -- so this is the only wizard call that works before a host profile exists,
 * and the only one that creates a row.
 */
export const create = (
  token: string,
  input: { name: string; venueName: string; spaceType: SpaceType }
) => request<SpotListing>("/host/spots", { method: "POST", body: input, token });

/** A soft cancel -- see the service for why this is not a row deletion. */
export const deleteSpot = (token: string, id: string) =>
  request<null>(`/host/spots/${id}`, { method: "DELETE", token });

export const saveType = (
  token: string,
  id: string,
  input: { name: string; venueName: string; spaceType: SpaceType; description?: string | null }
) =>
  request<SpotListing>(`/host/spots/${id}/type`, {
    method: "PATCH",
    body: input,
    token,
  });

export const saveAddress = (
  token: string,
  id: string,
  input: {
    societyName: string | null;
    building: string | null;
    street: string | null;
    area: string;
    city: string;
    state: string;
    pincode: string;
    latitude: number;
    longitude: number;
    googlePlaceId?: string;
    /** True once the host placed the pin on the map themselves. */
    pinConfirmed: boolean;
  }
) =>
  request<SpotListing>(`/host/spots/${id}/address`, {
    method: "PATCH",
    body: input,
    token,
  });

const presign = (
  token: string,
  id: string,
  path: "photo-upload-url" | "document-upload-url",
  input: { contentType: string; contentLength: number }
) =>
  request<PresignedUpload>(`/host/spots/${id}/${path}`, {
    method: "POST",
    body: input,
    token,
  });

export const presignPhoto = (
  token: string,
  id: string,
  input: { contentType: string; contentLength: number }
) => presign(token, id, "photo-upload-url", input);

export const presignDocument = (
  token: string,
  id: string,
  input: { contentType: string; contentLength: number }
) => presign(token, id, "document-upload-url", input);

/**
 * Sends the file to the object store.
 *
 * Deliberately a bare fetch rather than the API client: this PUT goes to the
 * storage provider, not to our API, so it must not carry the session token.
 */
export async function uploadFile(
  upload: PresignedUpload,
  file: Blob
): Promise<string> {
  const response = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: upload.headers,
    body: file,
  });

  if (!response.ok) {
    throw new Error("Upload failed");
  }

  return upload.fileUrl;
}

/** Order is the array order: the first URL becomes the cover photo. */
export const savePhotos = (token: string, id: string, urls: string[]) =>
  request<SpotListing>(`/host/spots/${id}/photos`, {
    method: "PATCH",
    body: { urls },
    token,
  });

export const saveOwnershipDocument = (token: string, id: string, url: string) =>
  request<SpotListing>(`/host/spots/${id}/ownership-document`, {
    method: "PATCH",
    body: { url },
    token,
  });

export const saveTerms = (
  token: string,
  id: string,
  input: {
    accessInstructions?: string;
    entryPoint?: string;
    warrantyAccepted?: true;
    entryMethod?: EntryMethod;
    bayNumber?: string | null;
    parkingMarker?: string | null;
  }
) =>
  request<SpotListing>(`/host/spots/${id}/terms`, {
    method: "PATCH",
    body: input,
    token,
  });

export const saveAvailability = (
  token: string,
  id: string,
  windows: { dayOfWeek: number; startMinute: number; endMinute: number }[]
) =>
  request<SpotListing & { outsideHours: OutsideHours }>(`/host/spots/${id}/availability`, {
    method: "PUT",
    body: { windows },
    token,
  });

/** Booking rules: shortest and longest stay, how far ahead. `null` = no rule of the host's own. */
export const saveBookingRules = (
  token: string,
  id: string,
  input: { minStayMinutes: number | null; maxStayMinutes: number | null; advanceDays: number | null }
) => request<SpotListing>(`/host/spots/${id}/booking-rules`, { method: "PATCH", body: input, token });

export const savePricing = (
  token: string,
  id: string,
  rates: { vehicleType: VehicleType; pricePerHour?: number; pricePerDay?: number; pricePerMonth?: number }[]
) =>
  request<SpotListing>(`/host/spots/${id}/pricing`, {
    method: "PATCH",
    body: { rates },
    token,
  });

export const readiness = (token: string, id: string) =>
  request<SpotReadiness>(`/host/spots/${id}/readiness`, { token });

export const submit = (token: string, id: string) =>
  request<SpotListing>(`/host/spots/${id}/submit`, {
    method: "POST",
    token,
  });

export const getPayoutAccount = (token: string) =>
  request<PayoutAccount>("/host/payout-account", { token });

export const submitPayoutAccount = (
  token: string,
  input: {
    panNumber: string;
    accountHolderName: string;
    accountNumber: string;
    ifsc: string;
  }
) =>
  request<PayoutAccount>("/host/payout-account", {
    method: "POST",
    body: input,
    token,
  });

/**
 * Parking details: covered or open, amenities, which vehicles, what fits.
 * Taking a vehicle type away deletes its prices on the server.
 */
export const saveDetails = (
  token: string,
  id: string,
  input: {
    covered: boolean;
    amenities: Amenity[];
    amenityNote: string | null;
    vehicleTypes: ("CAR" | "BIKE")[];
    maxVehicleSize: VehicleSize | null;
    maxVehicleHeightCm: number | null;
    bayWidthCm: number | null;
    bayLengthCm: number | null;
    notes: string | null;
  }
) => request<SpotListing>(`/host/spots/${id}/details`, { method: "PATCH", body: input, token });

/** Proof & permission: what the document is, owner or owner's permission, and the society's. */
export const savePermission = (
  token: string,
  id: string,
  input: { ownershipDocType: OwnershipDocType; permissionBasis: PermissionBasis; inSociety: boolean; societyPermission?: true }
) => request<SpotListing>(`/host/spots/${id}/permission`, { method: "PATCH", body: input, token });

/** Wizard (older): what the space offers. Allowed on a live space too. */
export const saveFeatures = (token: string, id: string, amenities: Amenity[]) =>
  request<SpotListing>(`/host/spots/${id}/features`, { method: "PATCH", body: { amenities }, token });

/** Wizard: what fits, and the host's rules. `null` clears one. */
export const saveLimits = (
  token: string,
  id: string,
  input: { maxVehicleHeightCm?: number | null; maxVehicleSize?: VehicleSize | null; rules?: string | null }
) => request<SpotListing>(`/host/spots/${id}/limits`, { method: "PATCH", body: input, token });
