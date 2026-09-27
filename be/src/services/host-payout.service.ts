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
import * as hostPayoutLedger from "./host-payout-ledger.service.js";
import * as hostService from "./host.service.js";

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
  /** A business account only; an individual sends none. */
  businessType?: string;
  phone?: string;
}

/** Statuses from which a host may (re)submit their details. */
const SUBMITTABLE = ["NOT_STARTED", "REJECTED", "ACTIVATED"];

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
 * The payout account of a signed-in user, host yet or not.
 *
 * Payouts are their own tab, reachable before anything is listed, so a user
 * without a host profile gets an empty "not set up" account rather than a
 * 403 -- the same shape the form reads, with no profile created by reading.
 */
export async function getStatusForUser(userId: string) {
  const profile = await activeProfileOf(userId);
  if (profile) return getStatus(profile.id);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true } });
  const empty = view({
    payoutAccountId: null,
    payoutKycStatus: "NOT_STARTED",
    panNumber: null,
    payoutAccountName: null,
    payoutAccountNumber: null,
    payoutIfsc: null,
    payoutSubmittedAt: null,
    payoutAccountType: null,
    payoutBusinessType: null,
    payoutIssue: null,
    payoutCheckedAt: null,
    user: { phone: user.phone },
  });
  return { ...empty, lastTransferIssue: null };
}

/**
 * The host's payout account (see accountStatus), and the last transfer to
 * their bank if it didn't reach them.
 *
 * Best-effort: a gateway that is down leaves the stored status on screen
 * rather than an error. The vendor-status webhook (onVendorNotice) now brings
 * changes in without anyone opening a screen; this check stays as the
 * fallback for a webhook that is late or not configured.
 */
export async function getStatus(hostProfileId: string) {
  const account = await accountStatus(hostProfileId);
  // The last transfer to the host's bank, when it didn't reach them: the
  // Payouts screen tells them, and what to fix.
  return { ...account, lastTransferIssue: await hostPayoutLedger.lastTransferIssue(hostProfileId) };
}

/**
 * Submits a signed-in user's payout details, making them a host if they are
 * not one yet: the payee the gateway registers is the host profile (its id is
 * the vendor id), and setting up payouts before listing is allowed.
 */
export async function submitForUser(userId: string, input: SubmitPayoutInput) {
  const hostProfileId = await hostService.ensureProfile(userId);
  await activeProfileOf(userId);
  return submit(hostProfileId, input);
}

/** The user's host profile, or null; a suspended one is refused, as requireHost does. */
async function activeProfileOf(userId: string) {
  const profile = await prisma.hostProfile.findUnique({ where: { userId }, select: { id: true, verificationStatus: true } });
  if (profile && profile.verificationStatus !== "ACTIVE") {
    throw new AppError("Host profile is not active", 403, "HOST_PROFILE_INACTIVE");
  }
  return profile;
}

/**
 * The host's payout account, read from the database -- and from the gateway
 * only while the gateway still owes an answer.
 *
 * When the gateway is asked (Get Vendor):
 *   - never with no vendor yet (NOT_STARTED): there is nothing to ask about;
 *   - never once settled: ACTIVATED is the answer, and REJECTED waits on the
 *     host fixing their details (which calls Update Vendor, not this);
 *   - while PENDING / UNDER_REVIEW, at most once per REFRESH_AFTER_MS across
 *     every request for this host. The slot is claimed with one conditional
 *     write, so the Host tab and the Payouts tab loading at once make one
 *     call between them, not two.
 */
async function accountStatus(hostProfileId: string) {
  const profile = await loadProfile(hostProfileId);
  const gateway = getPaymentGateway();

  if (gateway && profile.payoutAccountId && IN_PROGRESS.includes(profile.payoutKycStatus) && (await claimRefresh(hostProfileId))) {
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
 * VENDOR_STATUS_UPDATE from the gateway: a host's payee changed status
 * (verified, rejected, blocked...). Only the vendor id is taken from the
 * webhook; the status is asked of Get Vendor, the same call the Payouts
 * screen makes, and goes through `record` -- so an activation publishes the
 * listings that were waiting on it, with nobody opening a screen.
 *
 * Throws when the gateway can't be asked: the webhook is answered 5xx and
 * sent again.
 */
export async function onVendorNotice(vendorId: string): Promise<"HANDLED" | "IGNORED"> {
  const gateway = getPaymentGateway();
  const profile = await prisma.hostProfile.findUnique({
    where: { payoutAccountId: vendorId },
    select: { id: true, userId: true },
  });
  if (!gateway || !profile) {
    audit("PAYOUT_WEBHOOK_IGNORED", { vendorId, reason: profile ? "no gateway" : "unknown vendor" });
    return "IGNORED";
  }

  const vendor = await gateway.getVendor(vendorId);
  await record(profile.id, profile.userId, vendor, "getVendor");
  return "HANDLED";
}

/**
 * Takes this host's refresh slot if it is free: stamps payoutCheckedAt only
 * when the last check is older than REFRESH_AFTER_MS. Whoever's write lands
 * asks the gateway; a concurrent request finds the slot taken and reads the
 * database.
 */
async function claimRefresh(hostProfileId: string): Promise<boolean> {
  const claimed = await prisma.hostProfile.updateMany({
    where: {
      id: hostProfileId,
      OR: [{ payoutCheckedAt: null }, { payoutCheckedAt: { lt: new Date(Date.now() - REFRESH_AFTER_MS) } }],
    },
    data: { payoutCheckedAt: new Date() },
  });
  return claimed.count === 1;
}

/**
 * Submits the host's payout details.
 *
 * With a gateway: registers the host as its payee (Create Vendor), or updates
 * the payee they already are (Update Vendor) -- a host fixing a rejected
 * account, or an active one changing bank account. The gateway's answer sets
 * the status, whatever it was: an active host who changes account goes back
 * to "being checked" until the gateway verifies the new one, and their spaces
 * stop taking bookings meanwhile (search and booking need ACTIVATED) -- money
 * never goes to an account nobody has verified (owner's decision,
 * 2026-09-26). Nothing but the phone is saved if the gateway refuses the
 * details, so a failed submission never shows as "being checked".
 *
 * Without one: the details are recorded and the host waits at UNDER_REVIEW
 * for an admin.
 */
export async function submit(hostProfileId: string, input: SubmitPayoutInput) {
  const profile = await loadProfile(hostProfileId);

  if (!SUBMITTABLE.includes(profile.payoutKycStatus) && !needsDetails(profile)) {
    // Only an account mid-verification can't change: the gateway is still
    // checking what was sent, and a second set would race its answer.
    throw conflict("Payout details are being verified. You can change them once that finishes.");
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
    // What the host chose -- a business's category. An individual chose
    // nothing, so nothing is kept, though the gateway is sent a default.
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
    kyc: {
      accountType: input.accountType,
      // A business account only; an individual is sent without one.
      businessType: input.accountType === "BUSINESS" ? input.businessType : undefined,
      pan: input.panNumber,
    },
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
