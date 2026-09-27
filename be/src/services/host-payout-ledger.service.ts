import { Prisma } from "@prisma/client";
import type { GatewaySettlement, GatewaySettlementStatus } from "../integrations/payment/index.js";
import { day, rupees } from "../lib/format.js";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/security-log.js";
import { notify } from "./notification.service.js";

/**
 * Transfers of a host's money to their bank, as the gateway reports them.
 *
 * GatePass doesn't send hosts money: each order carries the host's share
 * (Easy Split), and the gateway pays it out to their bank by itself, T+2 by
 * default. Its settlement webhook is the only writer here; the host's
 * earnings and Payouts screens are the readers. Owner's decisions
 * (2026-09-27): one row per transfer, shown as transfer rows (not marked on
 * each booking); a failed or returned transfer is told to the host, with
 * what to fix when it is their account.
 */

/**
 * How far along a transfer is. Webhooks can come twice or out of order, so a
 * row only moves to a higher rank: a late INITIATED never undoes a SUCCESS,
 * and a SUCCESS can still become REVERSED when the bank sends it back.
 */
const RANK: Record<GatewaySettlementStatus, number> = { INITIATED: 0, SUCCESS: 1, FAILED: 1, REVERSED: 2 };

/**
 * Failure reasons that are the host's account to fix (Cashfree's
 * "Customer"/"Vendor" categories about the payee). Anything else is the
 * bank's side, which the host can only wait out.
 */
const ACCOUNT_REASONS = new Set([
  "INVALID_IFSC_FAIL",
  "INVALID_ACCOUNT_FAIL",
  "ACCOUNT_BLOCKED",
  "NRE_ACCOUNT_FAIL",
  "BENE_NAME_DIFFERS",
  "BENEFICIARY_NAME_DIFFERS",
  "INVALID_OR_NO_SUCH_ACCOUNT_TYPE",
  "INVALID_BENE_ACCOUNT_OR_IFSC",
  "BENEFICIARY_NOT_EXIST",
  "BENEFICIARY_BLACKLISTED",
  "PAYOUT_INACTIVE",
]);

const ACCOUNT_REASON_TEXT: Record<string, string> = {
  INVALID_IFSC_FAIL: "The IFSC code on your payout account isn't valid.",
  INVALID_ACCOUNT_FAIL: "Your bank says the account number isn't valid.",
  INVALID_BENE_ACCOUNT_OR_IFSC: "The account number or IFSC on your payout account isn't valid.",
  ACCOUNT_BLOCKED: "Your bank account is blocked.",
  NRE_ACCOUNT_FAIL: "NRE accounts can't receive these payments. Use a regular savings or current account.",
  BENE_NAME_DIFFERS: "The account holder name doesn't match your bank's records.",
  BENEFICIARY_NAME_DIFFERS: "The account holder name doesn't match your bank's records.",
  INVALID_OR_NO_SUCH_ACCOUNT_TYPE: "Your bank couldn't accept payments into this account.",
};

/** What a failed transfer means for the host, in words the app can show. */
export function transferIssue(reason: string | null): { message: string; fixable: boolean } {
  const code = (reason ?? "").trim().toUpperCase();
  if (ACCOUNT_REASONS.has(code)) {
    return {
      message: ACCOUNT_REASON_TEXT[code] ?? "Your payout account couldn't receive the transfer.",
      fixable: true,
    };
  }
  return {
    message: "Your bank couldn't take the transfer this time. The money is safe with our payment partner.",
    fixable: false,
  };
}

/**
 * Records one webhook about a transfer. Unknown payees (a vendor not ours,
 * or a host since removed) are acknowledged and logged, not stored.
 */
export async function recordSettlement(settlement: GatewaySettlement): Promise<"HANDLED" | "IGNORED"> {
  const host = await prisma.hostProfile.findUnique({
    where: { payoutAccountId: settlement.vendorId },
    select: { id: true, userId: true, payoutAccountNumber: true },
  });
  if (!host) {
    audit("HOST_PAYOUT_IGNORED", { settlementId: settlement.id, vendorId: settlement.vendorId, reason: "unknown vendor" });
    return "IGNORED";
  }

  const fields = {
    vendorId: settlement.vendorId,
    amount: new Prisma.Decimal(settlement.amount),
    utr: settlement.utr,
    reason: settlement.reason,
    periodFrom: settlement.periodFrom,
    periodTill: settlement.periodTill,
    initiatedAt: settlement.initiatedAt,
    settledAt: settlement.settledAt,
  };

  const existing = await prisma.hostPayout.findUnique({
    where: { gatewaySettlementId: settlement.id },
    select: { id: true, status: true },
  });

  let moved: boolean;
  if (!existing) {
    try {
      await prisma.hostPayout.create({
        data: { ...fields, hostProfileId: host.id, gatewaySettlementId: settlement.id, status: settlement.status },
      });
      moved = true;
    } catch (error) {
      // The same webhook twice at once: the other delivery wrote it; go again.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return recordSettlement(settlement);
      throw error;
    }
  } else if (RANK[settlement.status] > RANK[existing.status as GatewaySettlementStatus]) {
    // Conditional on the status read, so two deliveries racing move it once.
    const updated = await prisma.hostPayout.updateMany({
      where: { id: existing.id, status: existing.status },
      data: { ...fields, status: settlement.status },
    });
    if (updated.count === 0) return recordSettlement(settlement);
    moved = true;
  } else {
    // Same status again, or an older one arriving late: nothing moves.
    moved = false;
  }

  audit("HOST_PAYOUT_RECORDED", {
    userId: host.userId,
    hostProfileId: host.id,
    settlementId: settlement.id,
    status: settlement.status,
    amount: settlement.amount,
    moved,
  });

  if (moved) await tellHost(host, settlement);
  return "HANDLED";
}

async function tellHost(
  host: { userId: string; payoutAccountNumber: string | null },
  settlement: GatewaySettlement
): Promise<void> {
  const account = host.payoutAccountNumber ? ` •• ${host.payoutAccountNumber.slice(-4)}` : "";
  const at = settlement.settledAt ?? settlement.initiatedAt ?? undefined;
  // Keyed on the transfer and its status: a resent webhook adds nothing.
  const dedupeKey = `payout:${settlement.id}:${settlement.status}`;

  if (settlement.status === "SUCCESS") {
    await notify(host.userId, "HOST_PAYOUT", {
      title: "Payout sent",
      body: `${rupees(settlement.amount)} sent to your bank account${account}${settlement.utr ? ` · UTR ${settlement.utr}` : ""}.`,
      dedupeKey,
      at,
    });
    return;
  }

  if (settlement.status === "FAILED" || settlement.status === "REVERSED") {
    const issue = transferIssue(settlement.reason);
    await notify(host.userId, "HOST_PAYOUT", {
      title: settlement.status === "REVERSED" ? "Payout returned by your bank" : "Payout couldn't reach your bank",
      body: `${rupees(settlement.amount)}${at ? ` (${day(at)})` : ""}: ${issue.message}${issue.fixable ? " Update your bank details on the Payouts screen." : ""}`,
      dedupeKey,
      at,
    });
  }
}

/**
 * The host's latest transfer, when it didn't reach them -- what the Payouts
 * screen warns about. Cleared by the next transfer that does.
 */
export async function lastTransferIssue(hostProfileId: string) {
  const latest = await prisma.hostPayout.findFirst({
    where: { hostProfileId, status: { in: ["SUCCESS", "FAILED", "REVERSED"] } },
    orderBy: [{ initiatedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: { status: true, amount: true, reason: true, initiatedAt: true, updatedAt: true },
  });
  if (!latest || latest.status === "SUCCESS") return null;
  const issue = transferIssue(latest.reason);
  return {
    status: latest.status as "FAILED" | "REVERSED",
    amount: latest.amount.toString(),
    message: issue.message,
    /** The host can fix it by correcting their bank details. */
    fixable: issue.fixable,
    at: latest.initiatedAt ?? latest.updatedAt,
  };
}

/** Transfers on their way or landed, newest first, for the earnings screen. */
export async function transfersFor(hostProfileId: string) {
  return prisma.hostPayout.findMany({
    where: { hostProfileId, status: { in: ["INITIATED", "SUCCESS"] } },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, status: true, amount: true, utr: true, initiatedAt: true, settledAt: true, createdAt: true },
  });
}
