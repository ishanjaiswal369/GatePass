import type { ListingType } from "../constants/enums.js";
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

export async function list(organizerId?: string) {
  return prisma.listing.findMany({
    where: organizerId ? { organizerId } : undefined,
    include: {
      capacities: true,
      creator: true,
      updater: true,
    },
  });
}

export async function create(input: CreateListingInput, actorId: string) {
  return prisma.listing.create({
    data: {
      ...input,
      createdBy: actorId,
      updatedBy: actorId,
    },
  });
}
