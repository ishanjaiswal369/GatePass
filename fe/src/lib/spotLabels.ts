import type { Amenity, VehicleSize, VehicleType } from "@/constants/enums";
import type { SpaceType } from "@/types/api.types";

/**
 * How a spot's enums read to a driver. One table each, so the card, the
 * detail and the filters never call the same thing two names.
 */

export const SPACE_LABELS: Record<SpaceType, string> = {
  DRIVEWAY: "Driveway",
  GARAGE: "Garage",
  CAR_PARK: "Private lot",
  OTHER: "Parking space",
};

export function spaceLabel(type: SpaceType | null | undefined): string {
  return type ? SPACE_LABELS[type] : "Parking space";
}

export const AMENITY_LABELS: Record<Amenity, string> = {
  CCTV: "CCTV",
  SECURITY_GUARD: "Security",
  COVERED: "Covered",
  EV_CHARGING: "EV charging",
  WELL_LIT: "Well lit",
  WASHROOM: "Washroom",
};

export const VEHICLE_LABELS: Record<VehicleType, string> = {
  CAR: "Car",
  BIKE: "Bike",
  OTHER: "Other",
};

export const VEHICLE_SIZE_LABELS: Record<VehicleSize, string> = {
  HATCHBACK: "Hatchbacks",
  SEDAN: "Cars up to sedans",
  SUV: "Cars & SUVs",
  VAN: "Cars, SUVs & vans",
};

/** 213 → "7 ft (2.1 m)": feet first, the way drivers here read clearance. */
export function heightLabel(cm: number): string {
  const feet = cm / 30.48;
  const shown = Math.abs(feet - Math.round(feet)) < 0.1 ? String(Math.round(feet)) : feet.toFixed(1);
  return `${shown} ft (${(cm / 100).toFixed(1)} m)`;
}
