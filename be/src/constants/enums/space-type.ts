/**
 * What kind of space a host is renting out.
 *
 * ON_STREET is deliberately absent: a host cannot warrant exclusive use of
 * public kerbside, so listing one would sell something the host does not own.
 */
export const SPACE_TYPES = ["DRIVEWAY", "GARAGE", "CAR_PARK"] as const;

export type SpaceType = (typeof SPACE_TYPES)[number];

export const DEFAULT_SPACE_TYPE: SpaceType = "DRIVEWAY";
