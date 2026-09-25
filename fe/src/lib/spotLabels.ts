import type { Amenity, VehicleSize, VehicleType } from "@/constants/enums";
import type { EntryMethod, SpaceType } from "@/types/api.types";

/**
 * How a spot's enums read to a driver. One table each, so the card, the
 * detail and the filters never call the same thing two names.
 */

export const SPACE_LABELS: Record<SpaceType, string> = {
  DRIVEWAY: "Driveway",
  GARAGE: "Garage",
  CAR_PARK: "Car park bay",
  PRIVATE_LOT: "Private parking lot",
  SOCIETY: "Society parking",
  COMMERCIAL: "Commercial parking",
  OTHER: "Parking space",
};

/** The types a driver can filter on (OTHER is only on older listings). */
export const FILTERABLE_SPACE_TYPES: SpaceType[] = ["DRIVEWAY", "GARAGE", "CAR_PARK", "PRIVATE_LOT", "SOCIETY", "COMMERCIAL"];

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
  GATED: "Gated entry",
  EASY_ACCESS: "Easy access",
};

export const ENTRY_METHOD_LABELS: Record<EntryMethod, string> = {
  SECURITY_GUARD: "Security guard",
  GATE_CODE: "Gate code",
  INTERCOM: "Intercom",
  MANUAL_GATE: "Manual gate",
  OPEN_ACCESS: "Open access",
  OTHER: "Other",
};

/** 244 → "8 ft": bay sizes are read in whole feet. */
export function feetLabel(cm: number): string {
  const feet = cm / 30.48;
  return `${Math.abs(feet - Math.round(feet)) < 0.1 ? Math.round(feet) : feet.toFixed(1)} ft`;
}

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
