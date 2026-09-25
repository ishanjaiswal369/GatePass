import type { UserAddress, Vehicle } from "@/types/api.types";
import type { VehicleSize, VehicleType } from "@/constants/enums";
import { request } from "./client";

export const listVehicles = (token: string) =>
  request<{ vehicles: Vehicle[] }>("/vehicles", { token });

export const addVehicle = (
  token: string,
  input: {
    vehicleNumber: string;
    vehicleType: VehicleType;
    label?: string;
    size?: VehicleSize | null;
    isDefault?: boolean;
  }
) => request<Vehicle>("/vehicles", { method: "POST", body: input, token });

export const setDefaultVehicle = (token: string, id: string) =>
  request<Vehicle>(`/vehicles/${id}`, {
    method: "PATCH",
    body: { isDefault: true },
    token,
  });

export const removeVehicle = (token: string, id: string) =>
  request<null>(`/vehicles/${id}`, { method: "DELETE", token });

/** `address: null` until the user saves one, which is the common case. */
export const getAddress = (token: string) =>
  request<{ address: UserAddress | null }>("/address", { token });

/**
 * `country` is not sent: the API fixes it to India and refuses to take it from
 * the client.
 */
export const saveAddress = (
  token: string,
  input: { state: string; city: string; addressLine: string }
) =>
  request<{ address: UserAddress }>("/address", {
    method: "PUT",
    body: input,
    token,
  });
