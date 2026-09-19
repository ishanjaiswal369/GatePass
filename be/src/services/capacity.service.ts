import type { VehicleType } from "../constants/enums/index.js";
import { forbidden, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

export interface CreateCapacityInput {
  listingId: string;
  vehicleType: VehicleType;
  gate?: string;
  totalCapacity: number;
  price: number;
}

/** Capacity rows for the organizers this user is staff of. */
export async function list(organizerIds: string[], listingId?: string) {
  return prisma.parkingCapacity.findMany({
    where: {
      listing: {
        organizerId: { in: organizerIds },
        ...(listingId ? { id: listingId } : {}),
      },
    },
    orderBy: [{ listingId: "asc" }, { vehicleType: "asc" }],
  });
}

export async function create(
  input: CreateCapacityInput,
  organizerIds: string[]
) {
  const listing = await prisma.listing.findUnique({
    where: { id: input.listingId },
    select: { organizerId: true },
  });

  if (!listing) {
    throw notFound("Listing not found");
  }

  // Without this, anyone signed in could add cheap capacity to someone else's
  // event -- the price on a capacity row is what a booking is charged.
  if (!listing.organizerId || !organizerIds.includes(listing.organizerId)) {
    throw forbidden("You do not have access to this listing");
  }

  return prisma.parkingCapacity.create({ data: input });
}
