/**
 * What a host spot offers, as drivers filter on it. Stored as TEXT[] on
 * Listing. "24/7 access" is deliberately absent: it is derived from the
 * opening hours, so it cannot drift from them.
 */
export const AMENITIES = [
  "CCTV",
  "SECURITY_GUARD",
  "COVERED",
  "EV_CHARGING",
  "WELL_LIT",
  "WASHROOM",
] as const;

export type Amenity = (typeof AMENITIES)[number];

/** The largest vehicle a space takes, smallest first. */
export const VEHICLE_SIZES = ["HATCHBACK", "SEDAN", "SUV", "VAN"] as const;

export type VehicleSize = (typeof VEHICLE_SIZES)[number];
