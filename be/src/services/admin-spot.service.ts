import { badRequest, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

/**
 * Review and publication of host spots.
 *
 * Two independent gates stand between a submitted spot and a bookable one:
 *
 *   1. a human accepting the ownership document        (docApprovedAt)
 *   2. the gateway activating the host's payout account (payoutKycStatus)
 *
 * They are independent because they are decided by different parties on
 * different timelines -- an admin can clear the document while the bank
 * details are still being verified, or the reverse. Whichever lands second
 * publishes the listing, which is why both paths end in publishIfReady().
 *
 * Publishing on one gate alone has a concrete failure each way: approve
 * without payout and a driver can pay for a spot whose host cannot be paid;
 * publish on payout alone and nobody has checked the host owns the space.
 */

const reviewView = {
  id: true,
  name: true,
  venueName: true,
  spaceType: true,
  status: true,
  // The spot's own address, not the host's. A reviewer is checking that the
  // ownership document names this place, and a host with three driveways has
  // three addresses -- reading one off HostProfile would hand the reviewer
  // whichever spot was saved last.
  addressLine: true,
  city: true,
  state: true,
  pincode: true,
  latitude: true,
  longitude: true,
  accessInstructions: true,
  ownershipDocUrl: true,
  warrantyAcceptedAt: true,
  submittedAt: true,
  docApprovedAt: true,
  reviewedAt: true,
  rejectionReason: true,
  photos: { select: { url: true, position: true }, orderBy: { position: "asc" } },
  pricing: { select: { vehicleType: true, pricePerHour: true } },
  hostProfile: {
    select: {
      id: true,
      payoutKycStatus: true,
      verificationStatus: true,
      // The details behind payoutKycStatus. Unmasked, unlike the host's own
      // read: an admin clearing UNDER_REVIEW is checking exactly these, and
      // last four digits cannot be checked against anything.
      panNumber: true,
      payoutAccountName: true,
      payoutAccountNumber: true,
      payoutIfsc: true,
      payoutSubmittedAt: true,
      user: { select: { id: true, email: true, firstName: true, lastName: true } },
    },
  },
} as const;

/** The admin review queue: oldest submission first, so nobody waits forever. */
export async function listForReview(status = "PENDING_REVIEW") {
  return prisma.listing.findMany({
    where: { listingType: "INDEPENDENT_SPOT", status },
    select: reviewView,
    orderBy: { submittedAt: "asc" },
  });
}

export async function getForReview(listingId: string) {
  const spot = await prisma.listing.findFirst({
    where: { id: listingId, listingType: "INDEPENDENT_SPOT" },
    select: reviewView,
  });

  if (!spot) {
    throw notFound("Spot not found");
  }

  return spot;
}

/**
 * Publishes a spot if, and only if, both gates are clear.
 *
 * Safe to call from either gate and safe to call twice: it reads the current
 * state and does nothing when something is still outstanding. That is what
 * lets the doc approval and the payout activation arrive in either order
 * without either needing to know about the other.
 */
export async function publishIfReady(listingId: string) {
  const spot = await prisma.listing.findFirst({
    where: { id: listingId, listingType: "INDEPENDENT_SPOT" },
    select: {
      id: true,
      status: true,
      docApprovedAt: true,
      hostProfile: { select: { payoutKycStatus: true } },
    },
  });

  if (!spot) {
    throw notFound("Spot not found");
  }

  const payoutReady = spot.hostProfile?.payoutKycStatus === "ACTIVATED";
  const docReady = spot.docApprovedAt !== null;

  // Only a spot waiting on review is publishable here. A REJECTED or
  // SUSPENDED one needs a human to move it, not a gate landing late.
  if (spot.status !== "PENDING_REVIEW" || !docReady || !payoutReady) {
    return {
      published: false,
      docApproved: docReady,
      payoutReady,
      status: spot.status,
    };
  }

  const published = await prisma.listing.update({
    where: { id: listingId },
    data: { status: "PUBLISHED" },
    select: { id: true, status: true },
  });

  return {
    published: true,
    docApproved: true,
    payoutReady: true,
    status: published.status,
  };
}

/**
 * An admin accepting the ownership document.
 *
 * Records the decision and then tries to publish. It deliberately does not
 * fail when the payout account is not ready: the admin has done their part,
 * and blocking them on a bank verification they do not control would just
 * mean someone has to remember to come back.
 */
export async function approve(listingId: string, adminUserId: string) {
  const spot = await prisma.listing.findFirst({
    where: { id: listingId, listingType: "INDEPENDENT_SPOT" },
    select: { id: true, status: true, ownershipDocUrl: true },
  });

  if (!spot) {
    throw notFound("Spot not found");
  }

  if (spot.status !== "PENDING_REVIEW") {
    throw badRequest(`Cannot approve a spot that is ${spot.status}`);
  }

  if (!spot.ownershipDocUrl) {
    // The document is the whole point of this step; approving without one
    // would record a check that did not happen.
    throw badRequest("This spot has no ownership document to approve");
  }

  const now = new Date();

  await prisma.listing.update({
    where: { id: listingId },
    data: {
      docApprovedAt: now,
      reviewedAt: now,
      reviewedBy: adminUserId,
      rejectionReason: null,
      updatedBy: adminUserId,
    },
  });

  const result = await publishIfReady(listingId);

  return {
    ...result,
    // Says plainly why an approved spot is still not live, so the admin UI
    // does not have to infer it.
    waitingOn: result.published
      ? null
      : result.payoutReady
        ? "review"
        : "host payout account activation",
  };
}

export async function reject(
  listingId: string,
  adminUserId: string,
  reason: string
) {
  const spot = await prisma.listing.findFirst({
    where: { id: listingId, listingType: "INDEPENDENT_SPOT" },
    select: { id: true, status: true },
  });

  if (!spot) {
    throw notFound("Spot not found");
  }

  if (spot.status !== "PENDING_REVIEW") {
    throw badRequest(`Cannot reject a spot that is ${spot.status}`);
  }

  return prisma.listing.update({
    where: { id: listingId },
    data: {
      status: "REJECTED",
      // Cleared, so a host who fixes the document and resubmits is not
      // carrying a stale approval from the previous round.
      docApprovedAt: null,
      reviewedAt: new Date(),
      reviewedBy: adminUserId,
      rejectionReason: reason,
      updatedBy: adminUserId,
    },
    select: { id: true, status: true, rejectionReason: true },
  });
}

/** Taking a live spot down. Distinct from REJECTED, which never went live. */
export async function suspend(
  listingId: string,
  adminUserId: string,
  reason: string
) {
  const spot = await prisma.listing.findFirst({
    where: { id: listingId, listingType: "INDEPENDENT_SPOT" },
    select: { id: true, status: true },
  });

  if (!spot) {
    throw notFound("Spot not found");
  }

  if (!["PUBLISHED", "ONGOING"].includes(spot.status)) {
    throw badRequest(`Cannot suspend a spot that is ${spot.status}`);
  }

  return prisma.listing.update({
    where: { id: listingId },
    data: {
      status: "SUSPENDED",
      rejectionReason: reason,
      reviewedAt: new Date(),
      reviewedBy: adminUserId,
      updatedBy: adminUserId,
    },
    select: { id: true, status: true, rejectionReason: true },
  });
}
