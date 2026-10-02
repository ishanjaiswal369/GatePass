import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { IntegrationError } from "../integrations/errors.js";
import { getPaymentGateway, RefundExistsError, type GatewayRefund } from "../integrations/payment/index.js";
import { conflict, notFound, serviceUnavailable } from "../lib/errors.js";
import { bookingRef, rupees } from "../lib/format.js";
import { app } from "../lib/app.js";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/security-log.js";
import { notify } from "./notification.service.js";

/**
 * Money going back to drivers, at the gateway (specs/cashfree-refunds_design.md).
 *
 * A Refund row is opened inside the transaction that decides it -- a
 * cancellation, a late payment, a report upheld -- and sent from here only
 * once that has committed: a gateway call never holds a transaction open, and
 * a gateway that is down never undoes a cancellation.
 *
 * Three rules keep one refund from becoming two:
 * - The refund id sent to the gateway is derived from the row and its attempt,
 *   so sending it again is refused (and the existing one read back) rather
 *   than repeated.
 * - Every send and status check first claims the row with one conditional
 *   write, so the request, the job and a webhook never race each other.
 * - Every status move is conditional on REFUND_PENDING: a duplicate webhook,
 *   or a check that lands after one, changes nothing.
 *
 * The gateway's word decides the status. A webhook only names the refund; its
 * state is then asked of the gateway.
 */

/** Tries in all for one refund: the first, and two admin retries after a failure. */
export const MAX_ATTEMPTS = 3;
/** Sends of one attempt that get no answer before it is given up as FAILED. */
const MAX_SEND_TRIES = 5;
/** A send that got no answer waits 1, 2, 4, 8 minutes before the next. */
const SEND_BACKOFF_MS = 60_000;
/**
 * How long a claimed row is left to the request that claimed it. Longer than
 * a send can take (timeout x retries), so two sends never overlap.
 */
const CLAIM_MS = 60_000;
/** A pending refund is asked after by the job this often... */
const POLL_EVERY_MS = 10 * 60_000;
/** ...and when its driver opens the booking, at most this often. */
const READ_CHECK_EVERY_MS = 2 * 60_000;
const JOB_BATCH = 20;
const JOB_TICK_MS = 60_000;

const refundRow = {
  id: true,
  bookingId: true,
  amount: true,
  status: true,
  policy: true,
  attempt: true,
  sendTries: true,
  gatewayRefundId: true,
  splitAmount: true,
  submittedAt: true,
  checkedAt: true,
  booking: {
    select: {
      driverId: true,
      listing: { select: { name: true } },
      payment: {
        select: { status: true, amount: true, gatewayOrderId: true, splitVendorId: true, splitAmount: true },
      },
    },
  },
} satisfies Prisma.RefundSelect;

type RefundRow = Prisma.RefundGetPayload<{ select: typeof refundRow }>;

/** 3-40 letters and digits, fixed per row and attempt: "rf" + the row id, then "a2", "a3". */
export function gatewayRefundIdFor(id: string, attempt: number): string {
  return `rf${id.replace(/-/g, "")}${attempt > 1 ? `a${attempt}` : ""}`;
}

/** A UUID derived from the refund id, so every retry of one send carries the same key. */
function idempotencyKeyFor(gatewayRefundId: string): string {
  const hex = createHash("sha256").update(`refund:${gatewayRefundId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * The host's part of a refund: the same share of it as they had of the
 * payment (owner's decision, 2026-10-01 -- host 90, GatePass 10). This is
 * what the host earnings screen already assumes: a host keeps their share of
 * whatever isn't refunded.
 */
function hostPartOf(row: RefundRow): Prisma.Decimal | null {
  if (row.splitAmount) return row.splitAmount;
  const payment = row.booking.payment;
  if (!payment?.splitVendorId || !payment.splitAmount || payment.splitAmount.lte(0) || payment.amount.lte(0)) return null;
  const part = row.amount.mul(payment.splitAmount).div(payment.amount).toDecimalPlaces(2);
  return Prisma.Decimal.min(part, payment.splitAmount, row.amount);
}

/** Ids and the rule only: it shows on the gateway's dashboard and the bank statement. */
const noteFor = (row: RefundRow) => `GatePass ${bookingRef(row.bookingId)} ${row.policy}`.slice(0, 100);

/**
 * Sends a pending refund to the gateway. Safe to call from anywhere, any
 * number of times: a row already sent, being sent, or waiting out its backoff
 * is left alone. Never throws for the gateway's sake -- a failure is recorded
 * on the row and picked up by the job.
 */
export async function sendRefund(refundId: string, now = new Date()): Promise<void> {
  const gateway = getPaymentGateway();
  if (!gateway) return;

  const row = await prisma.refund.findUnique({ where: { id: refundId }, select: refundRow });
  if (!row || row.status !== "REFUND_PENDING" || row.submittedAt || row.sendTries >= MAX_SEND_TRIES) return;

  const payment = row.booking.payment;
  if (!payment || payment.status !== "CAPTURED" || !payment.gatewayOrderId) {
    await markFailed(row, "No captured gateway payment to refund", now);
    return;
  }
  if (row.amount.lte(0) || row.amount.gt(payment.amount)) {
    await markFailed(row, `Refund ${row.amount.toFixed(2)} is not within the ${payment.amount.toFixed(2)} paid`, now);
    return;
  }

  const gatewayRefundId = gatewayRefundIdFor(row.id, row.attempt);
  const hostPart = hostPartOf(row);

  // The claim: one send at a time, and the refund id and split fixed on the
  // row before the gateway hears of them.
  const claimed = await prisma.refund.updateMany({
    where: {
      id: row.id,
      status: "REFUND_PENDING",
      submittedAt: null,
      attempt: row.attempt,
      sendTries: row.sendTries,
      OR: [{ checkedAt: null }, { checkedAt: { lt: new Date(now.getTime() - CLAIM_MS) } }],
    },
    data: {
      checkedAt: now,
      sendTries: { increment: 1 },
      gatewayRefundId,
      ...(row.splitAmount === null && hostPart ? { splitAmount: hostPart } : {}),
    },
  });
  if (claimed.count === 0) return;

  const orderId = payment.gatewayOrderId;
  audit("REFUND_SEND", {
    refundId: row.id,
    bookingId: row.bookingId,
    orderId,
    gatewayRefundId,
    amount: row.amount.toFixed(2),
    hostPart: hostPart?.toFixed(2) ?? null,
    attempt: row.attempt,
    try: row.sendTries + 1,
  });

  try {
    const refund = await gateway.createRefund({
      orderId,
      refundId: gatewayRefundId,
      amount: row.amount.toFixed(2),
      note: noteFor(row),
      ...(hostPart && payment.splitVendorId ? { splits: [{ vendorId: payment.splitVendorId, amount: hostPart.toFixed(2) }] } : {}),
      idempotencyKey: idempotencyKeyFor(gatewayRefundId),
    });
    await accepted(row, refund, now);
  } catch (error) {
    if (error instanceof RefundExistsError) {
      // An earlier send got through and its answer was lost: that refund is this one.
      await accepted(row, await gateway.getRefund(orderId, gatewayRefundId), now);
      return;
    }

    const retryable = !(error instanceof IntegrationError) || error.retryable;
    const reason = error instanceof Error ? error.message : "Refund request failed";
    audit("REFUND_SEND_FAILED", { refundId: row.id, bookingId: row.bookingId, gatewayRefundId, retryable, reason });

    // Refused outright (a 4xx): sending the same thing again gets the same
    // answer. No answer, or a 5xx: the job sends it again, same refund id,
    // until the tries run out.
    if (!retryable || row.sendTries + 1 >= MAX_SEND_TRIES) {
      await markFailed(row, retryable ? `Gateway unreachable after ${MAX_SEND_TRIES} tries: ${reason}` : reason, now);
    }
  }
}

/** The gateway has the refund: record that, then its status. */
async function accepted(row: RefundRow, refund: GatewayRefund, now: Date): Promise<void> {
  await prisma.refund.updateMany({
    where: { id: row.id, gatewayRefundId: refund.refundId, status: "REFUND_PENDING", submittedAt: null },
    data: { submittedAt: now, gatewayRefundRef: refund.refundRef, checkedAt: now },
  });
  audit("REFUND_SUBMITTED", {
    refundId: row.id,
    bookingId: row.bookingId,
    gatewayRefundId: refund.refundId,
    gatewayRefundRef: refund.refundRef,
    status: refund.providerStatus,
  });
  await applyStatus(row, refund, now);
}

/**
 * The gateway's answer, recorded. Only ever moves a REFUND_PENDING row for
 * this very refund id, so a late or repeated answer changes nothing.
 */
async function applyStatus(row: RefundRow, refund: GatewayRefund, now: Date): Promise<void> {
  const current = { id: row.id, status: "REFUND_PENDING", gatewayRefundId: refund.refundId };

  if (refund.status === "PENDING") {
    await prisma.refund.updateMany({ where: current, data: { checkedAt: now, gatewayRefundRef: refund.refundRef } });
    return;
  }

  if (refund.status === "SUCCESS") {
    const processedAt = refund.processedAt ?? now;
    const moved = await prisma.refund.updateMany({
      where: current,
      data: {
        status: "REFUNDED",
        processedAt,
        reference: refund.bankReference,
        gatewayRefundRef: refund.refundRef,
        submittedAt: row.submittedAt ?? now,
        checkedAt: now,
      },
    });
    if (moved.count === 0) return;
    audit("REFUND_REFUNDED", { refundId: row.id, bookingId: row.bookingId, gatewayRefundId: refund.refundId, amount: row.amount.toFixed(2) });
    // Same key as the inbox sync's own "refund landed" entry, so it is written once.
    await notify(row.booking.driverId, "REFUND_SENT", {
      title: "Refund processed",
      body: `${rupees(row.amount)} for ${row.booking.listing?.name ?? "your booking"} is back with your bank.`,
      bookingId: row.bookingId,
      dedupeKey: `refunded:${row.bookingId}`,
    });
    return;
  }

  await markFailed(row, refund.description ?? `Gateway status ${refund.providerStatus}`, now, refund.refundId);
}

/**
 * The refund won't reach the driver on this attempt. Recorded with the
 * reason, the driver is told, and it waits for an admin's retry: never
 * resent on its own, so a real failure can't turn into a loop.
 */
async function markFailed(row: RefundRow, reason: string, now: Date, gatewayRefundId?: string): Promise<void> {
  const moved = await prisma.refund.updateMany({
    where: {
      id: row.id,
      status: "REFUND_PENDING",
      attempt: row.attempt,
      ...(gatewayRefundId ? { gatewayRefundId } : {}),
    },
    data: { status: "FAILED", failureReason: reason.slice(0, 500), checkedAt: now },
  });
  if (moved.count === 0) return;

  audit("REFUND_FAILED", { refundId: row.id, bookingId: row.bookingId, attempt: row.attempt, reason });
  await notify(row.booking.driverId, "REFUND_FAILED", {
    title: "Refund delayed",
    body: `Your refund of ${rupees(row.amount)} for ${bookingRef(row.bookingId)} didn't go through. Our team is on it; you don't need to do anything.`,
    bookingId: row.bookingId,
    dedupeKey: `refund-failed:${row.id}:${row.attempt}`,
  });
}

/**
 * Asks the gateway where a sent refund stands, at most once per `minGapMs`.
 * An unsent one is sent instead.
 */
export async function refreshRefund(refundId: string, now = new Date(), minGapMs = READ_CHECK_EVERY_MS): Promise<void> {
  const gateway = getPaymentGateway();
  if (!gateway) return;

  const row = await prisma.refund.findUnique({ where: { id: refundId }, select: refundRow });
  if (!row || row.status !== "REFUND_PENDING") return;
  if (!row.submittedAt || !row.gatewayRefundId) {
    await sendRefund(row.id, now);
    return;
  }
  const orderId = row.booking.payment?.gatewayOrderId;
  if (!orderId) return;

  const claimed = await prisma.refund.updateMany({
    where: {
      id: row.id,
      status: "REFUND_PENDING",
      OR: [{ checkedAt: null }, { checkedAt: { lt: new Date(now.getTime() - minGapMs) } }],
    },
    data: { checkedAt: now },
  });
  if (claimed.count === 0) return;

  await applyStatus(row, await gateway.getRefund(orderId, row.gatewayRefundId), now);
}

/** The driver opened a booking with a refund on its way: a throttled, best-effort check. */
export async function refreshForBooking(bookingId: string, now = new Date()): Promise<void> {
  const row = await prisma.refund.findUnique({ where: { bookingId }, select: { id: true, status: true } });
  if (row?.status !== "REFUND_PENDING") return;
  try {
    await refreshRefund(row.id, now, READ_CHECK_EVERY_MS);
  } catch (error) {
    app.log.warn({ err: error, bookingId }, "refund check failed");
  }
}

/**
 * Sends a refund just committed, without failing the request that opened it:
 * the cancellation (or report) stands whatever the gateway says, and the job
 * picks up anything left.
 */
export async function sendAfterCommit(refundId: string | null | undefined): Promise<void> {
  if (!refundId) return;
  try {
    await sendRefund(refundId);
  } catch (error) {
    app.log.warn({ err: error, refundId }, "refund send failed");
  }
}

/**
 * A refund webhook, its signature already checked. The body only named the
 * refund; what it says happened is asked of the gateway. Throws when the
 * gateway can't be asked, so the route answers 5xx and the gateway resends.
 */
export async function onRefundNotice(orderId: string, gatewayRefundId: string, now = new Date()): Promise<"HANDLED" | "IGNORED"> {
  const gateway = getPaymentGateway();
  if (!gateway) return "IGNORED";

  const row = await prisma.refund.findFirst({
    where: { gatewayRefundId, booking: { payment: { gatewayOrderId: orderId } } },
    select: refundRow,
  });
  if (!row) {
    // Not ours, or an earlier attempt of a refund since retried under a new id.
    audit("REFUND_WEBHOOK_UNMATCHED", { orderId, gatewayRefundId });
    return "IGNORED";
  }
  // Already final: a repeat of a webhook that was handled.
  if (row.status !== "REFUND_PENDING") return "HANDLED";

  const refund = await gateway.getRefund(orderId, gatewayRefundId);
  if (row.submittedAt) await applyStatus(row, refund, now);
  else await accepted(row, refund, now);
  return "HANDLED";
}

/**
 * The job's share: refunds never sent (the request that opened them stopped,
 * or the gateway didn't answer) are sent, with backoff; sent ones still
 * pending are asked after, so a missed webhook doesn't leave them pending.
 */
export async function runRefundJobs(now = new Date()): Promise<void> {
  if (!getPaymentGateway()) return;

  const unsent = await prisma.refund.findMany({
    where: { status: "REFUND_PENDING", submittedAt: null, sendTries: { lt: MAX_SEND_TRIES } },
    select: { id: true, sendTries: true, checkedAt: true },
    orderBy: { createdAt: "asc" },
    take: JOB_BATCH,
  });
  for (const row of unsent) {
    const wait = row.sendTries === 0 ? 0 : SEND_BACKOFF_MS * 2 ** (row.sendTries - 1);
    if (row.checkedAt && now.getTime() - row.checkedAt.getTime() < wait) continue;
    try {
      await sendRefund(row.id, now);
    } catch (error) {
      app.log.warn({ err: error, refundId: row.id }, "refund job: send failed");
    }
  }

  const pending = await prisma.refund.findMany({
    where: {
      status: "REFUND_PENDING",
      submittedAt: { not: null },
      OR: [{ checkedAt: null }, { checkedAt: { lt: new Date(now.getTime() - POLL_EVERY_MS) } }],
    },
    select: { id: true },
    orderBy: { checkedAt: "asc" },
    take: JOB_BATCH,
  });
  for (const row of pending) {
    try {
      await refreshRefund(row.id, now, POLL_EVERY_MS);
    } catch (error) {
      app.log.warn({ err: error, refundId: row.id }, "refund job: check failed");
    }
  }
}

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startRefundJobs(): void {
  if (timer) return;
  const tick = async () => {
    // A slow tick (a gateway timing out) must not overlap the next.
    if (running) return;
    running = true;
    try {
      await runRefundJobs();
    } catch (error) {
      app.log.error({ err: error }, "refund jobs: tick failed");
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => void tick(), JOB_TICK_MS);
  setTimeout(() => void tick(), 10_000).unref();
}

export function stopRefundJobs(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

// ---------------------------------------------------------------- admin --

const adminSelect = {
  id: true,
  bookingId: true,
  amount: true,
  splitAmount: true,
  status: true,
  policy: true,
  attempt: true,
  sendTries: true,
  gatewayRefundId: true,
  gatewayRefundRef: true,
  reference: true,
  failureReason: true,
  submittedAt: true,
  processedAt: true,
  createdAt: true,
  booking: { select: { payment: { select: { gatewayOrderId: true, gatewayPaymentId: true } } } },
} satisfies Prisma.RefundSelect;

function adminView(row: Prisma.RefundGetPayload<{ select: typeof adminSelect }>) {
  const { booking, ...rest } = row;
  return {
    ...rest,
    bookingRef: bookingRef(row.bookingId),
    // The whole trail, for reconciling against the gateway's dashboard.
    orderId: booking.payment?.gatewayOrderId ?? null,
    paymentId: booking.payment?.gatewayPaymentId ?? null,
    retryable: row.status === "FAILED" && row.attempt < MAX_ATTEMPTS,
  };
}

export async function listForAdmin(status?: string) {
  const rows = await prisma.refund.findMany({
    where: status ? { status } : {},
    select: adminSelect,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map(adminView);
}

/**
 * An admin sending a FAILED refund again, as a new attempt with a new refund
 * id -- at most MAX_ATTEMPTS in all.
 *
 * First it makes sure the last attempt really didn't go through: one whose
 * sends got no answer may have reached the gateway after all. If the gateway
 * has it and it hasn't failed, that one is adopted instead of paying twice.
 */
export async function retryFailedRefund(refundId: string, adminUserId: string, now = new Date()) {
  const gateway = getPaymentGateway();
  if (!gateway) throw serviceUnavailable("Online payment isn't switched on.");

  const row = await prisma.refund.findUnique({ where: { id: refundId }, select: refundRow });
  if (!row) throw notFound("Refund not found");
  if (row.status !== "FAILED") throw conflict("Only a failed refund can be retried.");
  if (row.attempt >= MAX_ATTEMPTS) {
    throw conflict(`This refund has been tried ${MAX_ATTEMPTS} times. Settle it from the Cashfree dashboard.`);
  }

  const orderId = row.booking.payment?.gatewayOrderId;
  if (orderId && row.gatewayRefundId) {
    let previous: GatewayRefund | null = null;
    try {
      previous = await gateway.getRefund(orderId, row.gatewayRefundId);
    } catch (error) {
      // 404: the gateway never had it, so a new attempt can't double it.
      // Anything else: we can't be sure, so no retry until we can.
      if (!(error instanceof IntegrationError && error.statusCode === 404)) {
        throw serviceUnavailable("Couldn't check the last attempt with the payment gateway. Try again shortly.");
      }
    }
    if (previous && previous.status !== "FAILED") {
      const revived = await prisma.refund.updateMany({
        where: { id: row.id, status: "FAILED", attempt: row.attempt },
        data: { status: "REFUND_PENDING", submittedAt: now, failureReason: null, gatewayRefundRef: previous.refundRef, checkedAt: now },
      });
      if (revived.count > 0) {
        audit("REFUND_RECOVERED", { userId: adminUserId, refundId: row.id, gatewayRefundId: row.gatewayRefundId, status: previous.providerStatus });
        await applyStatus({ ...row, status: "REFUND_PENDING", submittedAt: now }, previous, now);
      }
      return adminView(await prisma.refund.findUniqueOrThrow({ where: { id: row.id }, select: adminSelect }));
    }
  }

  const next = await prisma.refund.updateMany({
    where: { id: row.id, status: "FAILED", attempt: row.attempt },
    data: {
      status: "REFUND_PENDING",
      attempt: row.attempt + 1,
      gatewayRefundId: null,
      gatewayRefundRef: null,
      reference: null,
      submittedAt: null,
      sendTries: 0,
      checkedAt: null,
      failureReason: null,
    },
  });
  if (next.count === 0) throw conflict("This refund changed. Refresh and try again.");

  audit("REFUND_RETRIED", { userId: adminUserId, refundId: row.id, bookingId: row.bookingId, attempt: row.attempt + 1 });
  await sendAfterCommit(row.id);
  return adminView(await prisma.refund.findUniqueOrThrow({ where: { id: row.id }, select: adminSelect }));
}
