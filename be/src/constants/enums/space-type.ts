/**
 * What kind of space a host is renting out.
 *
 * ON_STREET is deliberately absent: a host cannot warrant exclusive use of
 * public kerbside, so listing one would sell something the host does not own.
 */
/**
 * CAR_PARK is "Car park bay": an allotted bay in a society or commercial car
 * park. Covered or open is not a type -- a covered driveway is still a
 * driveway -- it is the COVERED amenity. OTHER is kept for older rows; the
 * wizard doesn't offer it.
 */
export const SPACE_TYPES = [
  "DRIVEWAY",
  "GARAGE",
  "CAR_PARK",
  "PRIVATE_LOT",
  "SOCIETY",
  "COMMERCIAL",
  "OTHER",
] as const;

export type SpaceType = (typeof SPACE_TYPES)[number];

export const DEFAULT_SPACE_TYPE: SpaceType = "DRIVEWAY";
