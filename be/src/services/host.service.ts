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
 * Onboarding. Creates the profile and the one listing that represents the
 * host's spot in the same transaction, because a profile without a listing is
 * invisible to search and a listing without a profile cannot exist.
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

export async function listAvailability(hostProfileId: string) {
  return prisma.hostAvailability.findMany({
    where: { hostProfileId },
    orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
  });
}

export async function addAvailability(
  hostProfileId: string,
  input: AvailabilityInput
) {
  return prisma.hostAvailability.create({
    data: { hostProfileId, ...input },
  });
}

export async function updateAvailability(
  id: string,
  hostProfileId: string,
  input: Partial<AvailabilityInput>
) {
  // hostProfileId is part of the filter so one host cannot toggle another
  // host's window by id.
  const updated = await prisma.hostAvailability.updateMany({
    where: { id, hostProfileId },
    data: input,
  });

  if (updated.count === 0) {
    throw notFound("Availability window not found");
  }

  return prisma.hostAvailability.findUniqueOrThrow({ where: { id } });
}

export async function removeAvailability(id: string, hostProfileId: string) {
  const deleted = await prisma.hostAvailability.deleteMany({
    where: { id, hostProfileId },
  });

  if (deleted.count === 0) {
    throw notFound("Availability window not found");
  }
}
