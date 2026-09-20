import { badRequest, conflict, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import * as adminSpotService from "./admin-spot.service.js";

/**
 * The host's payout account: the thing that has to exist before money can
 * reach them.
 *
 * Gateway-neutral by design. Today submitting here records the details and
 * parks the host at UNDER_REVIEW for an admin to clear by hand; when the
 * gateway integration lands, submit() calls it and maps the vendor status
 * onto the same five values. Nothing outside this file needs to change,
 * because nothing outside this file names a gateway.
 *
 * Bank details are write-only. They go in, they gate publication, and they
 * never come back out over the wire -- see payoutView.
 */

/** Never includes account numbers. */
const payoutView = {
  payoutAccountId: true,
  payoutKycStatus: true,
} as const;

export interface SubmitPayoutInput {
  panNumber: string;
  accountHolderName: string;
  accountNumber: string;
  ifsc: string;
}

/** Statuses from which a host may (re)submit their details. */
const SUBMITTABLE = ["NOT_STARTED", "REJECTED"];

export async function getStatus(hostProfileId: string) {
  const profile = await prisma.hostProfile.findUnique({
    where: { id: hostProfileId },
    select: payoutView,
  });

  if (!profile) {
    throw notFound("Host profile not found");
  }

  return profile;
}

/**
 * Submits the host's payout details.
 *
 * The PAN is stored on the profile; the bank details are not stored here at
 * all yet. That is deliberate rather than an oversight: holding account
 * numbers earns nothing until a gateway needs them, and the gateway will hold
 * them once it does. When the integration lands, these go straight to it and
 * only the returned account id is kept.
 */
export async function submit(
  hostProfileId: string,
  input: SubmitPayoutInput
) {
  const profile = await prisma.hostProfile.findUnique({
    where: { id: hostProfileId },
    select: { id: true, payoutKycStatus: true },
  });

  if (!profile) {
    throw notFound("Host profile not found");
  }

  if (!SUBMITTABLE.includes(profile.payoutKycStatus)) {
    throw conflict(
      profile.payoutKycStatus === "ACTIVATED"
        ? "Payout account is already active"
        : "Payout details are already under review"
    );
  }

  return prisma.hostProfile.update({
    where: { id: hostProfileId },
    data: {
      panNumber: input.panNumber,
      // UNDER_REVIEW, not ACTIVATED: nobody has checked these details yet.
      // Marking them active here would open the publication gate on the
      // host's own say-so.
      payoutKycStatus: "UNDER_REVIEW",
    },
    select: payoutView,
  });
}

/**
 * Moves a host's payout status, and publishes anything that was only waiting
 * on it.
 *
 * Called by an admin today and by the gateway's webhook later; both go
 * through here so the "did this unblock a listing" step cannot be forgotten
 * by whichever path is added next.
 */
export async function setStatus(
  hostProfileId: string,
  status: string,
  payoutAccountId?: string
) {
  const profile = await prisma.hostProfile.findUnique({
    where: { id: hostProfileId },
    select: { id: true },
  });

  if (!profile) {
    throw notFound("Host profile not found");
  }

  if (status === "ACTIVATED" && !payoutAccountId) {
    const existing = await prisma.hostProfile.findUnique({
      where: { id: hostProfileId },
      select: { payoutAccountId: true },
    });

    if (!existing?.payoutAccountId) {
      // An activated host with no account id has nowhere for money to go;
      // the status would be a lie the publication gate then trusts.
      throw badRequest(
        "A payout account id is required to activate a host"
      );
    }
  }

  const updated = await prisma.hostProfile.update({
    where: { id: hostProfileId },
    data: {
      payoutKycStatus: status,
      ...(payoutAccountId ? { payoutAccountId } : {}),
    },
    select: payoutView,
  });

  const published: string[] = [];

  if (status === "ACTIVATED") {
    // The other gate may have cleared days ago. Whichever lands second is the
    // one that publishes, so activation has to check.
    const waiting = await prisma.listing.findMany({
      where: {
        hostProfileId,
        listingType: "INDEPENDENT_SPOT",
        status: "PENDING_REVIEW",
        docApprovedAt: { not: null },
      },
      select: { id: true },
    });

    for (const listing of waiting) {
      const result = await adminSpotService.publishIfReady(listing.id);
      if (result.published) {
        published.push(listing.id);
      }
    }
  }

  return { ...updated, publishedListingIds: published };
}
