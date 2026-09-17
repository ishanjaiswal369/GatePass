export const VEHICLE_TYPES = ["CAR", "BIKE", "OTHER"] as const;

export type VehicleType = (typeof VEHICLE_TYPES)[number];
