import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { PayoutAccountType } from "../constants/enums/index.js";
import { IntegrationError } from "../integrations/errors.js";
import {
  getPaymentGateway,
  VendorExistsError,
  type GatewayVendor,
  type PaymentGateway,
  type VendorInput,
} from "../integrations/payment/index.js";
import { AppError, badRequest, conflict, notFound } from "../lib/errors.js";
import { normalisePhone } from "../lib/phone.js";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/security-log.js";
import * as adminSpotService from "./admin-spot.service.js";

/**
 * The host's payout account: the thing that has to exist before money can
 * reach them.
 *
 * With a gateway configured (PAYMENT_PROVIDER=cashfree), submitting registers
 * the host as the gateway's payee -- a Cashfree Easy Split vendor -- and the
 * gateway's verdict becomes payoutKycStatus. Without one, the details are
 * recorded and the host waits at UNDER_REVIEW for an admin, as before.
 * Nothing outside this file names a gateway.
 *
 * Bank details are write-only. They go in, they gate publication, and they
 * never come back out over the wire -- see `view`.
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
  payoutAccountType: true,
  payoutBusinessType: true,
  payoutIssue: true,
  payoutCheckedAt: true,
  user: { select: { phone: true } },
} satisfies Prisma.HostProfileSelect;

type PayoutRow = Prisma.HostProfileGetPayload<{ select: typeof payoutColumns }>;

export interface SubmitPayoutInput {
  panNumber: string;
  accountHolderName: string;
  accountNumber: string;
  ifsc: string;
  accountType: PayoutAccountType;
  businessType?: string;
  phone?: string;
}

/** Statuses from which a host may (re)submit their details. */
const SUBMITTABLE = ["NOT_STARTED", "REJECTED"];

/** Still being checked: the only statuses worth asking the gateway about again. */
const IN_PROGRESS = ["PENDING", "UNDER_REVIEW"];

/** How often opening the payout screen may ask the gateway for a fresh status. */
const REFRESH_AFTER_MS = 30_000;

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
    accountType: row.payoutAccountType,
    businessType: row.payoutBusinessType,
    /** What to fix, when the status is REJECTED: BANK_ACCOUNT, KYC or BLOCKED. */
    issue: row.payoutKycStatus === "REJECTED" ? row.payoutIssue : null,
    submittedAt: row.payoutSubmittedAt,
    needsDetails: needsDetails(row),
    /** The submit form must ask for a mobile number: the profile has none and the gateway needs one. */
    needsPhone: !row.user.phone,
  };
}

/** Our vendor id for a host: stable, and only the characters Cashfree allows. */
export function vendorIdFor(hostProfileId: string): string {
  return `host_${hostProfileId.replace(/-/g, "")}`;
}

/** The gateway's three states as our payout statuses. */
const STATUS_FOR: Record<GatewayVendor["state"], string> = {
  ACTIVE: "ACTIVATED",
  PENDING: "UNDER_REVIEW",
  FAILED: "REJECTED",
};

async function loadProfile(hostProfileId: string) {
  const profile = await prisma.hostProfile.findUnique({
    where: { id: hostProfileId },
    select: { ...payoutColumns, userId: true, user: { select: { phone: true, email: true, firstName: true, lastName: true } } },
  });
  if (!profile) throw notFound("Host profile not found");
  return profile;
}

/**
 * The host's payout account, with a fresh status from the gateway when it is
 * still being checked -- so a host who opens "Getting paid" after the
 * gateway has finished sees the answer without waiting for a webhook.
 *
 * The refresh is best-effort: throttled, and a gateway that is down leaves
 * the stored status on screen rather than an error.
 */
export async function getStatus(hostProfileId: string) {
  const profile = await loadProfile(hostProfileId);
  const gateway = getPaymentGateway();

  const stale = !profile.payoutCheckedAt || Date.now() - profile.payoutCheckedAt.getTime() > REFRESH_AFTER_MS;
  if (gateway && profile.payoutAccountId && IN_PROGRESS.includes(profile.payoutKycStatus) && stale) {
    try {
      const vendor = await gateway.getVendor(profile.payoutAccountId);
      const refreshed = await record(hostProfileId, profile.userId, vendor, "getVendor");
      if (refreshed) return refreshed;
    } catch (error) {
      console.warn("payout status refresh failed; showing the stored status", error instanceof Error ? error.message : error);
    }
  }

  return view(profile);
}

/**
 * Submits the host's payout details.
 *
 * With a gateway: registers the host as its payee (Create Vendor), or updates
 * the payee they already are (Update Vendor) -- a host fixing a rejected
 * account. The gateway's answer sets the status. Nothing but the phone is
 * saved if the gateway refuses the details, so a failed submission never
 * shows as "being checked".
 *
 * Without one: the details are recorded and the host waits at UNDER_REVIEW
 * for an admin.
 */
export async function submit(hostProfileId: string, input: SubmitPayoutInput) {
  const profile = await loadProfile(hostProfileId);

  if (!SUBMITTABLE.includes(profile.payoutKycStatus) && !needsDetails(profile)) {
    throw conflict(
      profile.payoutKycStatus === "ACTIVATED"
        ? "Payout account is already active"
        : "Payout details are already under review"
    );
  }

  // Update Vendor sends status ACTIVE; a blocked payee re-submitting must not
  // be how they get unblocked.
  if (profile.payoutKycStatus === "REJECTED" && profile.payoutIssue === "BLOCKED") {
    throw conflict("Your payout account is blocked. Contact support to reopen it.");
  }

  const details = {
    panNumber: input.panNumber,
    payoutAccountName: input.accountHolderName,
    payoutAccountNumber: input.accountNumber,
    payoutIfsc: input.ifsc,
    payoutAccountType: input.accountType,
    payoutBusinessType: input.accountType === "BUSINESS" ? input.businessType ?? null : null,
    payoutSubmittedAt: new Date(),
  };

  const gateway = getPaymentGateway();
  if (!gateway) {
    const updated = await prisma.hostProfile.update({
      where: { id: hostProfileId },
      // UNDER_REVIEW, not ACTIVATED: nobody has checked these details yet.
      // Marking them active here would open the publication gate on the
      // host's own say-so.
      data: { ...details, payoutKycStatus: "UNDER_REVIEW", payoutIssue: null },
      select: payoutColumns,
    });
    return view(updated);
  }

  const phone = await resolvePhone(profile.userId, profile.user.phone, input.phone);
  const vendorId = profile.payoutAccountId ?? vendorIdFor(hostProfileId);
  const profileName = [profile.user.firstName, profile.user.lastName].filter(Boolean).join(" ").trim();
  const vendorInput: VendorInput = {
    vendorId,
    // The person, as GatePass knows them; the bank's name for the account
    // goes in bank.accountHolder, where the gateway matches it.
    name: profileName.length >= 3 ? profileName : input.accountHolderName,
    email: profile.user.email,
    phone,
    bank: { accountNumber: input.accountNumber, accountHolder: input.accountHolderName, ifsc: input.ifsc },
    kyc: { accountType: input.accountType, businessType: details.payoutBusinessType ?? undefined, pan: input.panNumber },
    // One per submission, reused by the client's retries of it.
    idempotencyKey: randomUUID(),
  };

  const { vendor, operation } = await registerVendor(gateway, vendorInput, Boolean(profile.payoutAccountId));

  await prisma.hostProfile.update({
    where: { id: hostProfileId },
    data: { ...details, payoutAccountId: vendor.vendorId },
  });
  const result = await record(hostProfileId, profile.userId, vendor, operation, true);
  return result!;
}

/**
 * Create Vendor for a host the gateway hasn't seen, Update Vendor for one it
 * has. A create that finds the id taken -- an earlier submission that went
 * through but whose answer was lost -- becomes an update.
 */
async function registerVendor(
  gateway: PaymentGateway,
  input: VendorInput,
  known: boolean
): Promise<{ vendor: GatewayVendor; operation: "createVendor" | "updateVendor" }> {
  try {
    if (!known) {
      try {
        return { vendor: await gateway.createVendor(input), operation: "createVendor" };
      } catch (error) {
        if (!(error instanceof VendorExistsError)) throw error;
      }
    }
    return { vendor: await gateway.updateVendor(input), operation: "updateVendor" };
  } catch (error) {
    throw detailsRejected(error);
  }
}

/**
 * The gateway refusing the host's details (a 4xx about the input) is the
 * host's to fix, so it comes back as a 422 with the gateway's reason. Our own
 * credentials failing (401/403), throttling or an outage stays a 502.
 */
function detailsRejected(error: unknown): unknown {
  if (
    error instanceof IntegrationError &&
    error.statusCode !== undefined &&
    error.statusCode >= 400 &&
    error.statusCode < 500 &&
    ![401, 403, 409, 429].includes(error.statusCode)
  ) {
    const reason = (error.raw as { message?: string } | undefined)?.message ?? error.message;
    const rejected = new AppError(`The bank couldn't accept these details: ${reason}`, 422, "PAYOUT_DETAILS_REJECTED");
    rejected.extra = { code: "PAYOUT_DETAILS_REJECTED" };
    return rejected;
  }
  return error;
}

/**
 * The phone the gateway gets: the profile's, or the one typed on the payout
 * screen when the profile has none -- which is then saved to the profile.
 */
async function resolvePhone(userId: string, current: string | null, typed?: string): Promise<string> {
  let phone = current;

  if (!phone) {
    if (!typed) {
      const error = new AppError("Add your mobile number to set up payouts.", 409, "PHONE_REQUIRED");
      error.extra = { code: "PHONE_REQUIRED" };
      throw error;
    }
    phone = normalisePhone(typed);
    try {
      await prisma.user.update({ where: { id: userId }, data: { phone } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw conflict("That mobile number is already on another account.");
      }
      throw error;
    }
  }

  // Stored as +91XXXXXXXXXX (lib/phone); the gateway wants the ten digits.
  return phone.replace(/^\+91/, "");
}

/**
 * Writes what the gateway said about the host's payee and, when that moves
 * the payout status, moves it through setStatus -- so an activation publishes
 * any listing that was only waiting on it. Returns the new view, or null when
 * nothing changed.
 */
async function record(
  hostProfileId: string,
  userId: string,
  vendor: GatewayVendor,
  operation: string,
  always = false
) {
  const before = await prisma.hostProfile.findUniqueOrThrow({
    where: { id: hostProfileId },
    select: { payoutKycStatus: true, payoutGatewayStatus: true },
  });
  const status = STATUS_FOR[vendor.state];

  await prisma.hostProfile.update({
    where: { id: hostProfileId },
    data: {
      payoutGatewayStatus: vendor.providerStatus,
      payoutIssue: vendor.issue ?? null,
      payoutCheckedAt: new Date(),
    },
  });

  if (!always && before.payoutKycStatus === status && before.payoutGatewayStatus === vendor.providerStatus) {
    return null;
  }

  audit(operation === "getVendor" ? "PAYOUT_STATUS_CHANGED" : "PAYOUT_VENDOR_SUBMITTED", {
    userId,
    hostProfileId,
    vendorId: vendor.vendorId,
    operation,
    status,
    providerStatus: vendor.providerStatus,
  });

  const result = await setStatus(hostProfileId, status);
  const { publishedListingIds: _published, ...shown } = result;
  return shown;
}

/**
 * Moves a host's payout status, and publishes anything that was only waiting
 * on it.
 *
 * Called by an admin, and by the gateway sync above (the webhook later); all
 * go through here so the "did this unblock a listing" step cannot be
 * forgotten by whichever path is added next.
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
      ...(status !== "REJECTED" ? { payoutIssue: null } : {}),
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
