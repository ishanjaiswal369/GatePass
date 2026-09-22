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

/** What is read out of the database. Masked before it leaves — see `view`. */
const payoutColumns = {
  payoutAccountId: true,
  payoutKycStatus: true,
  panNumber: true,
  payoutAccountName: true,
  payoutAccountNumber: true,
  payoutIfsc: true,
  payoutSubmittedAt: true,
} as const;

type PayoutRow = {
  payoutAccountId: string | null;
  payoutKycStatus: string;
  panNumber: string | null;
  payoutAccountName: string | null;
  payoutAccountNumber: string | null;
  payoutIfsc: string | null;
  payoutSubmittedAt: Date | null;
};

export interface SubmitPayoutInput {
  panNumber: string;
  accountHolderName: string;
  accountNumber: string;
  ifsc: string;
}

/** Statuses from which a host may (re)submit their details. */
const SUBMITTABLE = ["NOT_STARTED", "REJECTED"];

/**
 * Whether this host still has to enter their details.
 *
 * Not the same question as "what is the status". A host who submitted before
 * these columns existed is sitting at UNDER_REVIEW with nothing stored: the
 * bank details were validated and thrown away, so there is no review anyone
 * could finish and no status that could honestly move. Status alone would
 * lock them out of the one screen that fixes it, permanently.
 *
 * ACTIVATED is excluded because it is the one status that means money has
 * somewhere to go, whatever this table remembers about how.
 */
function needsDetails(row: PayoutRow): boolean {
  return row.payoutKycStatus !== "ACTIVATED" && !row.payoutAccountNumber;
}

/** `ABCDE1234F` -> `ABCDE****F`: enough to recognise, not enough to reuse. */
function maskPan(pan: string | null): string | null {
  return pan ? `${pan.slice(0, 5)}****${pan.slice(-1)}` : null;
}

/**
 * What the host gets back.
 *
 * The account number is the one field that never returns in full. A host
 * reading this screen is checking they typed the right account, and the last
 * four digits answer that; anything more only widens what a stolen session is
 * worth. The IFSC is public (it names a branch, not a person), so it comes
 * back whole -- it is also the field most often mistyped.
 */
function view(row: PayoutRow) {
  return {
    payoutAccountId: row.payoutAccountId,
    payoutKycStatus: row.payoutKycStatus,
    panNumber: maskPan(row.panNumber),
    accountHolderName: row.payoutAccountName,
    accountNumberLast4: row.payoutAccountNumber?.slice(-4) ?? null,
    ifsc: row.payoutIfsc,
    submittedAt: row.payoutSubmittedAt,
    needsDetails: needsDetails(row),
  };
}

export async function getStatus(hostProfileId: string) {
  const profile = await prisma.hostProfile.findUnique({
    where: { id: hostProfileId },
    select: payoutColumns,
  });

  if (!profile) {
    throw notFound("Host profile not found");
  }

  return view(profile);
}

/**
 * Submits the host's payout details.
 *
 * These are kept, which they were not before: the PAN was stored and the bank
 * details were validated and dropped, on the reasoning that a gateway would
 * hold them once one existed. There is no gateway yet, so what that actually
 * produced was a host parked at UNDER_REVIEW and an admin with nothing to
 * review -- a status that could never honestly move.
 *
 * When the gateway integration lands, this is the one place that changes:
 * the details go to it, and the columns hold nothing but the account id it
 * returns.
 */
export async function submit(
  hostProfileId: string,
  input: SubmitPayoutInput
) {
  const profile = await prisma.hostProfile.findUnique({
    where: { id: hostProfileId },
    select: payoutColumns,
  });

  if (!profile) {
    throw notFound("Host profile not found");
  }

  if (!SUBMITTABLE.includes(profile.payoutKycStatus) && !needsDetails(profile)) {
    throw conflict(
      profile.payoutKycStatus === "ACTIVATED"
        ? "Payout account is already active"
        : "Payout details are already under review"
    );
  }

  const updated = await prisma.hostProfile.update({
    where: { id: hostProfileId },
    data: {
      panNumber: input.panNumber,
      payoutAccountName: input.accountHolderName,
      payoutAccountNumber: input.accountNumber,
      payoutIfsc: input.ifsc,
      payoutSubmittedAt: new Date(),
      // UNDER_REVIEW, not ACTIVATED: nobody has checked these details yet.
      // Marking them active here would open the publication gate on the
      // host's own say-so.
      payoutKycStatus: "UNDER_REVIEW",
    },
    select: payoutColumns,
  });

  return view(updated);
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
    select: payoutColumns,
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

  return { ...view(updated), publishedListingIds: published };
}
