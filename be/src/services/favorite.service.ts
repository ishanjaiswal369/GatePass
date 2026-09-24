import { Prisma } from "@prisma/client";
import { notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

/**
 * Spots a driver saved for later.
 *
 * Saving and unsaving are both idempotent -- a double tap, or a retry after a
 * dropped response, lands in the same state instead of erroring -- because a
 * heart button is exactly the control people tap twice.
 */

const BOOKABLE = {
  listingType: "INDEPENDENT_SPOT",
  status: { in: ["PUBLISHED", "ONGOING"] },
  hostProfile: { verificationStatus: "ACTIVE", payoutKycStatus: "ACTIVATED" },
} satisfies Prisma.ListingWhereInput;

export async function list(userId: string) {
  const rows = await prisma.favorite.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      listing: {
        select: {
          id: true,
          name: true,
          city: true,
          addressLine: true,
          spaceType: true,
          amenities: true,
          status: true,
          photos: { select: { url: true }, orderBy: { position: "asc" }, take: 1 },
          pricing: { select: { pricePerHour: true, pricePerDay: true } },
          hostProfile: { select: { verificationStatus: true, payoutKycStatus: true } },
        },
      },
    },
  });

  return rows.map(({ createdAt, listing }) => {
    const hours = listing.pricing.map((p) => Number(p.pricePerHour));
    const days = listing.pricing.flatMap((p) => (p.pricePerDay ? [Number(p.pricePerDay)] : []));
    return {
      savedAt: createdAt,
      id: listing.id,
      name: listing.name,
      city: listing.city,
      addressLine: listing.addressLine,
      spaceType: listing.spaceType,
      amenities: listing.amenities,
      coverPhotoUrl: listing.photos[0]?.url ?? null,
      pricePerHour: hours.length ? Math.min(...hours) : null,
      pricePerDay: days.length ? Math.min(...days) : null,
      // A saved spot can stop taking bookings. It stays in the list, marked,
      // rather than vanishing without explanation.
      bookable:
        (listing.status === "PUBLISHED" || listing.status === "ONGOING") &&
        listing.hostProfile?.verificationStatus === "ACTIVE" &&
        listing.hostProfile?.payoutKycStatus === "ACTIVATED",
    };
  });
}

/** Only a spot a driver could book can be saved, so a guessed id learns nothing. */
export async function save(userId: string, listingId: string): Promise<{ saved: true }> {
  const spot = await prisma.listing.findFirst({ where: { id: listingId, ...BOOKABLE }, select: { id: true } });
  if (!spot) throw notFound("Spot not found");

  await prisma.favorite.upsert({
    where: { userId_listingId: { userId, listingId } },
    update: {},
    create: { userId, listingId },
  });

  return { saved: true };
}

export async function unsave(userId: string, listingId: string): Promise<{ saved: false }> {
  await prisma.favorite.deleteMany({ where: { userId, listingId } });
  return { saved: false };
}
