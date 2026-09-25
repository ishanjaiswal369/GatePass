import { Prisma } from "@prisma/client";

/**
 * How much of a host's location a driver sees, and when.
 *
 * Before paying: the society, area, city and a point rounded to three
 * decimals (about 100 m), so a driver can judge the walk without being handed
 * one house on a street. After paying: the full address and the exact pin.
 * Distances are always computed from the exact point, server-side.
 */

/** Three decimal places of a degree: ~110 m of latitude, less of longitude in India. */
export function approximate(value: Prisma.Decimal | number | string | null | undefined): Prisma.Decimal | null {
  if (value === null || value === undefined) return null;
  return new Prisma.Decimal(value).toDecimalPlaces(3);
}

interface LocatedListing {
  addressLine?: string | null;
  latitude?: Prisma.Decimal | null;
  longitude?: Prisma.Decimal | null;
}

/** The listing as a driver may see it before payment: no street line, a rounded pin. */
export function coarsen<T extends LocatedListing>(listing: T): T {
  return {
    ...listing,
    ...("addressLine" in listing ? { addressLine: null } : {}),
    ...("latitude" in listing ? { latitude: approximate(listing.latitude) } : {}),
    ...("longitude" in listing ? { longitude: approximate(listing.longitude) } : {}),
  };
}
