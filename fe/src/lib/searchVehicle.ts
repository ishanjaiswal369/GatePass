import { VEHICLE_LABELS } from "@/lib/spotLabels";
import type { Vehicle } from "@/types/api.types";

/**
 * Which of the driver's vehicles a search is for.
 *
 * Picked once, on the search form, and carried in the criteria (`vehicle`)
 * through results, the spot and checkout, so every screen answers the same
 * question. Only the vehicle's type narrows anything -- a bike or scooter sees
 * the spaces that take bikes, and any car, small or large, sees every space
 * that takes cars.
 */

/** "Show every space", whatever it takes. */
export const ANY_VEHICLE = "any";

/**
 * The vehicle named by the criteria; the driver's default (then their first)
 * when none was named, as on a link from before vehicles were chosen; null
 * for ANY_VEHICLE or a driver with no vehicles.
 */
export function searchVehicle(vehicles: Vehicle[], chosen: string | null | undefined): Vehicle | null {
  if (chosen === ANY_VEHICLE) return null;
  return vehicles.find((v) => v.id === chosen) ?? vehicles.find((v) => v.isDefault) ?? vehicles[0] ?? null;
}

/** "UP35AB1234 · Car · Hyundai Creta" -- the number first, as the gate reads it. */
export function vehicleLine(vehicle: Vehicle): string {
  return [vehicle.vehicleNumber, VEHICLE_LABELS[vehicle.vehicleType], vehicle.label].filter(Boolean).join(" · ");
}
