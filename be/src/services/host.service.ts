import type { Prisma } from "@prisma/client";
import { conflict, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

export interface CreateHostProfileInput {
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
  latitude: number;
  longitude: number;
  panNumber?: string;
  bankAccountId?: string;
}

export interface CreateListingInput {
  addressLine: string;
  city: string;
  pincode: string;
  latitude: number;
  longitude: number;
}

export interface AvailabilityInput {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  pricePerHour: number;
  isActive?: boolean;
}

/** panNumber and bankAccountId never go back over the wire. */
const hostProfileView = {
  id: true,
  addressLine: true,
  city: true,
  state: true,
  pincode: true,
  latitude: true,
  longitude: true,
  verificationStatus: true,
  createdAt: true,
} satisfies Prisma.HostProfileSelect;

/** A host's own view of one of their spots. */
const hostListingView = {
  id: true,
  name: true,
  addressLine: true,
  city: true,
  pincode: true,
  latitude: true,
  longitude: true,
  status: true,
  verificationStatus: true,
  createdAt: true,
} satisfies Prisma.ListingSelect;

export async function getByUserId(userId: string) {
  return prisma.hostProfile.findUnique({
    where: { userId },
    select: hostProfileView,
  });
}

/**
 * Whether this user is a host. Used by /auth/me so the app can render the Host
 * tab's destination on first paint instead of discovering it on tap.
 */
export async function exists(userId: string): Promise<boolean> {
  const row = await prisma.hostProfile.findUnique({
    where: { userId },
    select: { id: true },
  });

  return row !== null;
}

/**
 * Onboarding. Creates the profile and its first listing in the same
 * transaction, because a profile without a listing is invisible to search and
 * a listing without a profile cannot exist. Further spots go through
 * `createListing` once the profile exists.
 *
 * The spot is PUBLISHED immediately -- submit means active, per the product
 * decision -- but it still only surfaces once the host adds an availability
 * window, which is the host's own on/off switch.
 */
export async function createProfile(
  userId: string,
  input: CreateHostProfileInput
) {
  const existing = await prisma.hostProfile.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (existing) {
    throw conflict("Host profile already exists");
  }

  return prisma.$transaction(async (tx) => {
    const profile = await tx.hostProfile.create({
      data: { userId, ...input },
    });

    await tx.listing.create({
      data: {
        hostProfileId: profile.id,
        listingType: "INDEPENDENT_SPOT",
        name: `Parking at ${input.addressLine}`,
        venueName: `${input.addressLine}, ${input.city}`,
        addressLine: input.addressLine,
        city: input.city,
        pincode: input.pincode,
        latitude: input.latitude,
        longitude: input.longitude,
        status: "PUBLISHED",
        createdBy: userId,
        updatedBy: userId,
      },
    });

    return tx.hostProfile.findUniqueOrThrow({
      where: { id: profile.id },
      select: hostProfileView,
    });
  });
}

/** Every spot this host has listed, including ones they have since deleted. */
export async function listListings(hostProfileId: string) {
  return prisma.listing.findMany({
    where: { hostProfileId, listingType: "INDEPENDENT_SPOT" },
    select: hostListingView,
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Adds another spot for an already-onboarded host. Separate from
 * `createProfile` because a host is one profile with (now) many spots, and
 * onboarding already proved the profile half of this.
 */
export async function createListing(
  hostProfileId: string,
  userId: string,
  input: CreateListingInput
) {
  return prisma.listing.create({
    data: {
      hostProfileId,
      listingType: "INDEPENDENT_SPOT",
      name: `Parking at ${input.addressLine}`,
      venueName: `${input.addressLine}, ${input.city}`,
      addressLine: input.addressLine,
      city: input.city,
      pincode: input.pincode,
      latitude: input.latitude,
      longitude: input.longitude,
      status: "PUBLISHED",
      createdBy: userId,
      updatedBy: userId,
    },
    select: hostListingView,
  });
}

/**
 * Removing a spot is a cancel, not a row deletion, matching how account
 * deletion already takes a host's listings out of search: the listing and its
 * booking history (once bookings against host spots exist) have to survive,
 * only its visibility does not. Its availability windows are switched off
 * alongside it -- a re-published listing with no active windows would just be
 * an empty listing, but a cancelled one showing windows as still on on the
 * next screen would look like the delete silently failed.
 */
export async function deleteListing(
  id: string,
  hostProfileId: string,
  userId: string
) {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.listing.updateMany({
      where: { id, hostProfileId, listingType: "INDEPENDENT_SPOT" },
      data: { status: "CANCELLED", updatedBy: userId },
    });

    if (updated.count === 0) {
      throw notFound("Listing not found");
    }

    await tx.hostAvailability.updateMany({
      where: { listingId: id },
      data: { isActive: false },
    });
  });
}

async function assertOwnsListing(listingId: string, hostProfileId: string) {
  const listing = await prisma.listing.findFirst({
    where: { id: listingId, hostProfileId, listingType: "INDEPENDENT_SPOT" },
    select: { id: true, status: true },
  });

  if (!listing) {
    throw notFound("Listing not found");
  }

  if (listing.status === "CANCELLED") {
    throw conflict("This listing has been deleted");
  }
}

/**
 * A host's windows, across all their spots or narrowed to one. Ownership is
 * proven through the listing relation rather than a stored hostProfileId --
 * see the schema note on HostAvailability -- so one host can never read or
 * touch another host's windows by id.
 */
export async function listAvailability(
  hostProfileId: string,
  listingId?: string
) {
  return prisma.hostAvailability.findMany({
    where: listingId
      ? { listingId, listing: { hostProfileId } }
      : { listing: { hostProfileId } },
    orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
  });
}

export async function addAvailability(
  hostProfileId: string,
  listingId: string,
  input: AvailabilityInput
) {
  await assertOwnsListing(listingId, hostProfileId);

  return prisma.hostAvailability.create({
    data: { listingId, ...input },
  });
}

export async function updateAvailability(
  id: string,
  hostProfileId: string,
  input: Partial<AvailabilityInput>
) {
  // The listing relation is part of the filter so one host cannot toggle
  // another host's window by id.
  const updated = await prisma.hostAvailability.updateMany({
    where: { id, listing: { hostProfileId } },
    data: input,
  });

  if (updated.count === 0) {
    throw notFound("Availability window not found");
  }

  return prisma.hostAvailability.findUniqueOrThrow({ where: { id } });
}

export async function removeAvailability(id: string, hostProfileId: string) {
  const deleted = await prisma.hostAvailability.deleteMany({
    where: { id, listing: { hostProfileId } },
  });

  if (deleted.count === 0) {
    throw notFound("Availability window not found");
  }
}
