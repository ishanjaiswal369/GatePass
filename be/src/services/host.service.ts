import { Prisma } from "@prisma/client";
import { notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

/**
 * Price is absent on purpose: it moved to SpotPricing, which holds one rate
 * per vehicle type for the whole spot. It used to sit on each window, which
 * meant one spot could quote two rates depending on which window a booking
 * landed in.
 */
export interface AvailabilityInput {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  isActive?: boolean;
}

/**
 * An address is absent because a host no longer has one: each spot carries
 * its own, and a host with two driveways has two. Payout
 * details never go back over the wire from here -- host-payout.service owns
 * that read, and masks it.
 */
const hostProfileView = {
  id: true,
  verificationStatus: true,
  payoutKycStatus: true,
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
 * The host profile for this user, creating it on first use.
 *
 * Becoming a host is no longer a step of its own. It used to be: onboarding
 * asked for an address, wrote a HostProfile and opened a listing named after
 * that address, all before the host had said what they were listing. That is
 * what put a nameless "New spot" on the dashboard for anyone who opened the
 * wizard and closed it again.
 *
 * Now the first thing the wizard asks for is the listing's name, and the
 * profile is a side effect of creating that listing -- so there is no state
 * between "not a host" and "a host with a named spot". This returns only the
 * id because that is all its one caller (spot-listing.service.createSpot)
 * needs.
 */
export async function ensureProfile(userId: string): Promise<string> {
  const existing = await prisma.hostProfile.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (existing) return existing.id;

  try {
    const created = await prisma.hostProfile.create({
      data: { userId },
      select: { id: true },
    });

    return created.id;
  } catch (error) {
    // A double-tapped Continue sends two creates, and the loser hits userId's
    // unique index. The row it lost to is the one it wanted, so read it back
    // rather than failing a request that asked for nothing unreasonable.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const raced = await prisma.hostProfile.findUniqueOrThrow({
        where: { userId },
        select: { id: true },
      });

      return raced.id;
    }

    throw error;
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
  const listing = await prisma.listing.findFirst({
    where: { id: listingId, hostProfileId, listingType: "INDEPENDENT_SPOT" },
    select: { id: true },
  });

  if (!listing) {
    throw notFound("Listing not found");
  }

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
