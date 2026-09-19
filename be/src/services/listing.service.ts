import type { Prisma } from "@prisma/client";
import type { ListingType } from "../constants/enums/index.js";
import { forbidden } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

export interface CreateListingInput {
  organizerId: string;
  name: string;
  venueName: string;
  listingType?: ListingType;
  eventDate?: Date;
  latitude?: number;
  longitude?: number;
}

/**
 * The organizer's own view of a listing.
 *
 * `creator` and `updater` used to be included as whole User rows, which put
 * every organizer's email and phone number into a response any signed-in
 * driver could fetch. Audit columns are ids here; resolving them to people is
 * an admin concern, not a list-screen one.
 */
const listingView = {
  id: true,
  organizerId: true,
  listingType: true,
  name: true,
  venueName: true,
  latitude: true,
  longitude: true,
  eventDate: true,
  status: true,
  createdBy: true,
  updatedBy: true,
  createdAt: true,
  updatedAt: true,
  capacities: {
    select: {
      id: true,
      vehicleType: true,
      gate: true,
      price: true,
      totalCapacity: true,
      bookedCount: true,
    },
  },
} satisfies Prisma.ListingSelect;

/**
 * Listings belonging to the organizers this user is staff of. The scope comes
 * from requireOrganizerStaff, never from a query parameter -- an organizerId
 * in the URL would let any organizer read any other organizer's inventory.
 */
export async function list(organizerIds: string[]) {
  return prisma.listing.findMany({
    where: { organizerId: { in: organizerIds } },
    select: listingView,
    orderBy: { eventDate: "desc" },
  });
}

export async function create(
  input: CreateListingInput,
  organizerIds: string[],
  actorId: string
) {
  if (!organizerIds.includes(input.organizerId)) {
    throw forbidden("You do not have access to this organizer");
  }

  return prisma.listing.create({
    data: {
      ...input,
      createdBy: actorId,
      updatedBy: actorId,
    },
    select: listingView,
  });
}
