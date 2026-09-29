import { Prisma } from "@prisma/client";
import { getPaymentGateway, type GatewayPayment } from "../integrations/payment/index.js";
import { AppError } from "../lib/errors.js";
import { clock } from "../lib/format.js";
import { assertNotBlocked, lockListing } from "../lib/listing-lock.js";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/security-log.js";
import { isOverlapViolation } from "./booking.service.js";
import { notify } from "./notification.service.js";

/**
 * Money in, turned into a booking.
 *
 * The gateway's word is the only thing that makes a booking CONFIRMED. It
 * arrives two ways, and both end in `recordSuccess`:
 * - here, by asking the gateway (Get Payments for Order) while a driver's
 *   screen is waiting on the booking;
 * - the gateway's webhook (the next step), which lands whether or not anyone
 *   is looking.
 * Whichever comes first does the work; the other finds it done. Every write
 * is conditional on the state it moves from, so running both, twice, or at
 * the same moment changes nothing more than running one.
 *
 * A payment can land after its hold lapsed (it was started just before the
 * order stopped taking payment). Owner's decision (2026-09-27): the booking
 * is confirmed if its hours are still free, otherwise the whole amount is
 * refunded.
 */

/** Screens poll every few seconds; the gateway is asked at most this often per booking. */
const CHECK_EVERY_MS = 5_000;

/**
 * How long after an order stops taking payment an attempt already under way
 * can still land. Past this nobody asks the gateway on a screen's behalf any
 * more; the webhook still settles anything later.
 */
const LATE_WINDOW_MS = 30 * 60_000;

const toPaise = (value: string | Prisma.Decimal) => Math.round(Number(value) * 100);

/**
 * Asks the gateway how the booking's order stands and settles what it says.
 *
 * Called on reads of a booking by its own driver (the pay screen polls one),
 * so it is cheap when there is nothing to do: no gateway, nothing unpaid, an
 * order long closed, or a check a moment ago by another request -- none of
 * those call the gateway. Best-effort: a gateway error leaves things as they
 * were, and the next read tries again.
 */
export async function refreshPayment(bookingId: string, driverId: string, now = new Date()): Promise<void> {
  const gateway = getPaymentGateway();
  if (!gateway) return;

  // The driver in the WHERE: only a booking's own driver sets off a check.
  const row = await prisma.payment.findFirst({
    where: { bookingId, booking: { driverId } },
    select: { id: true, status: true, gatewayOrderId: true, gatewayExpiresAt: true },
  });
  if (!row?.gatewayOrderId) return;

  // Captured earlier but not finished (the process stopped between the two
  // steps): finish it, without asking the gateway again.
  if (row.status === "CAPTURED") {
    await resolvePaidBooking(bookingId, now);
    return;
  }
  if (row.status !== "CREATED") return;
  if (row.gatewayExpiresAt && now.getTime() > row.gatewayExpiresAt.getTime() + LATE_WINDOW_MS) return;

  // One conditional write claims the check, so the pay screen, the booking
  // screen and a second tab polling together make one gateway call.
  const claimed = await prisma.payment.updateMany({
    where: {
      id: row.id,
      status: "CREATED",
      OR: [{ gatewayCheckedAt: null }, { gatewayCheckedAt: { lt: new Date(now.getTime() - CHECK_EVERY_MS) } }],
    },
    data: { gatewayCheckedAt: now },
  });
  if (claimed.count === 0) return;

  try {
    await settleFromGateway(bookingId, row.gatewayOrderId, "poll", now);
  } catch (error) {
    // Logged by the gateway client with its request id; the booking waits
    // for the next read, or the webhook.
    console.warn(`payment check for booking ${bookingId} failed: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Asks the gateway for the order's payments and records a success. The one
 * path both triggers share: whatever a screen or a webhook says happened,
 * what counts is the gateway's own answer to this call.
 */
async function settleFromGateway(bookingId: string, orderId: string, source: "poll" | "webhook", now: Date): Promise<void> {
  const gateway = getPaymentGateway();
  if (!gateway) return;
  const payments = await gateway.getOrderPayments(orderId);
  const success = payments.find((payment) => payment.status === "SUCCESS");
  if (success) {
    await recordSuccess(bookingId, success, source, now);
  } else {
    // A CAPTURED row that isn't resolved yet still gets finished.
    await resolvePaidBooking(bookingId, now);
    await tellDriverOfFailure(bookingId, payments, now);
  }
}

/**
 * "Your payment didn't go through", for the latest declined attempt.
 *
 * Only FAILED -- the bank or UPI app said no. USER_DROPPED (the driver backed
 * out) and PENDING are not news to them. Keyed on the attempt, so the pay
 * screen's polling and the webhook describing the same attempt write it once;
 * a second failed try is a second entry.
 */
async function tellDriverOfFailure(bookingId: string, payments: GatewayPayment[], now: Date): Promise<void> {
  const failed = payments
    .filter((payment) => payment.status === "FAILED")
    .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))[0];
  if (!failed) return;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      driverId: true,
      status: true,
      holdExpiresAt: true,
      extendsBookingId: true,
      listing: { select: { name: true } },
    },
  });
  // Confirmed by a later attempt, or cancelled: the failure is history.
  if (!booking || booking.status !== "PENDING") return;

  const place = booking.listing?.name ?? "your parking";
  const stillHeld = booking.holdExpiresAt !== null && booking.holdExpiresAt > now;
  await notify(booking.driverId, "PAYMENT_FAILED", {
    title: booking.extendsBookingId ? "Payment for extra time didn't go through" : "Payment didn't go through",
    body: stillHeld
      ? `No money was taken. ${place} is held for you until ${clock(booking.holdExpiresAt!)}. Try again.`
      : `No money was taken. The hold on ${place} has ended; book again to try.`,
    // An extension's tap opens the stay it extends.
    bookingId: booking.extendsBookingId ?? bookingId,
    dedupeKey: `payfail:${failed.paymentRef}`,
  });
}

/**
 * A signed payment webhook about one of our orders (see
 * gateway-webhook.service). Only a nudge -- "look at order X" -- and the same
 * Get Payments call the pay screen uses decides what happened, so a
 * replayed, reordered or duplicated webhook can't do more than an extra look.
 * Unlike a screen's check it is neither throttled nor limited to recent
 * orders: a webhook can arrive late, and it arrives once.
 *
 * Throws when the gateway can't be asked, so the webhook is answered 5xx and
 * sent again.
 */
export async function onOrderNotice(orderId: string, type: string, now = new Date()): Promise<"HANDLED" | "IGNORED"> {
  const row = await prisma.payment.findUnique({ where: { gatewayOrderId: orderId }, select: { bookingId: true } });

  audit("PAYMENT_WEBHOOK_RECEIVED", { type, orderId, bookingId: row?.bookingId ?? null });

  // Not an order of ours (another integration on the account, a deleted
  // test booking): acknowledged, so the gateway stops sending it.
  if (!row) return "IGNORED";

  await settleFromGateway(row.bookingId, orderId, "webhook", now);
  return "HANDLED";
}

/**
 * Records a successful payment against the booking's Payment row and settles
 * the booking. The webhook calls this too.
 *
 * Refused (and logged) if the payment isn't for this row's order or isn't
 * for exactly the amount the row says: the booking must never be confirmed
 * for less than it costs, whatever the gateway's answer claims.
 */
export async function recordSuccess(
  bookingId: string,
  payment: GatewayPayment,
  source: "poll" | "webhook",
  now = new Date()
): Promise<void> {
  const row = await prisma.payment.findUnique({
    where: { bookingId },
    select: { id: true, status: true, amount: true, gatewayOrderId: true, gatewayPaymentId: true },
  });
  if (!row) return;

  if (payment.orderId !== row.gatewayOrderId || payment.currency !== "INR" || toPaise(payment.amount) !== toPaise(row.amount)) {
    audit("PAYMENT_MISMATCH", {
      bookingId,
      paymentId: row.id,
      source,
      orderId: row.gatewayOrderId,
      gatewayOrderId: payment.orderId,
      expected: row.amount.toFixed(2),
      received: payment.amount,
      currency: payment.currency,
      paymentRef: payment.paymentRef,
    });
    return;
  }

  // From CREATED only: a row already captured (by the other path) or
  // refunded is left alone.
  const captured = await prisma.payment.updateMany({
    where: { id: row.id, status: "CREATED" },
    data: { status: "CAPTURED", gatewayPaymentId: payment.paymentRef },
  });

  if (captured.count > 0) {
    audit("PAYMENT_CAPTURED", {
      bookingId,
      paymentId: row.id,
      source,
      orderId: payment.orderId,
      paymentRef: payment.paymentRef,
      method: payment.method,
    });
  } else if (row.status === "CAPTURED" && row.gatewayPaymentId && row.gatewayPaymentId !== payment.paymentRef) {
    // A second successful payment on one order: the gateway allows only one,
    // so this is worth a person's attention, not an automatic action.
    audit("PAYMENT_DUPLICATE_SUCCESS", { bookingId, paymentId: row.id, kept: row.gatewayPaymentId, extra: payment.paymentRef });
  }

  await resolvePaidBooking(bookingId, now);
}

export type PaidOutcome = "CONFIRMED" | "REFUNDING" | "ALREADY_SETTLED" | "NOT_PAID";

/**
 * A paid booking, confirmed or refunded. Safe to run any number of times:
 * each branch moves only from the state it expects.
 *
 * - Still PENDING -- its hold may have lapsed, but nobody took the hours
 *   (taking them sweeps the hold to CANCELLED first) -- so it is confirmed.
 * - Swept to CANCELLED by someone else's booking attempt (a lapsed hold,
 *   no cancelledAt): confirmed if the hours are still free, else refunded.
 * - Cancelled by the driver before the payment landed: refunded.
 * - A stay already over by the time the money arrived: refunded.
 */
export async function resolvePaidBooking(bookingId: string, now = new Date()): Promise<PaidOutcome> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      status: true,
      cancelledAt: true,
      listingId: true,
      startsAt: true,
      endsAt: true,
      driverId: true,
      payment: { select: { status: true, amount: true } },
      refund: { select: { id: true } },
    },
  });
  if (!booking || booking.payment?.status !== "CAPTURED") return "NOT_PAID";
  if (booking.refund || booking.status === "CONFIRMED" || booking.status === "COMPLETED" || booking.status === "NO_SHOW") {
    return "ALREADY_SETTLED";
  }

  const amount = booking.payment.amount;

  if (booking.endsAt && booking.endsAt <= now) {
    return openRefund(booking.id, amount, "PAID_AFTER_STAY", booking.driverId);
  }

  if (booking.status === "PENDING") {
    const moved = await prisma.booking.updateMany({
      where: { id: booking.id, status: "PENDING" },
      data: { status: "CONFIRMED" },
    });
    if (moved.count > 0) {
      audit("BOOKING_CONFIRMED", { bookingId: booking.id, userId: booking.driverId });
      return "CONFIRMED";
    }
    // Moved on meanwhile (swept, or confirmed by the other path): look again.
    return resolvePaidBooking(bookingId, now);
  }

  if (booking.status === "CANCELLED" && booking.cancelledAt === null && booking.listingId && booking.startsAt && booking.endsAt) {
    const { listingId, startsAt, endsAt } = booking;
    try {
      const revived = await prisma.$transaction(async (tx) => {
        // The same lock and block check every claim on a listing's time
        // takes (lib/listing-lock); the EXCLUDE constraint refuses the
        // update if another booking holds any of these hours now.
        await lockListing(tx, listingId);
        await assertNotBlocked(tx, listingId, startsAt, endsAt);
        return tx.booking.updateMany({
          where: { id: booking.id, status: "CANCELLED", cancelledAt: null },
          data: { status: "CONFIRMED" },
        });
      });
      if (revived.count > 0) {
        audit("BOOKING_CONFIRMED", { bookingId: booking.id, userId: booking.driverId, afterLapsedHold: true });
        return "CONFIRMED";
      }
      return resolvePaidBooking(bookingId, now);
    } catch (error) {
      // Another booking has the hours (the EXCLUDE constraint), or the host
      // blocked them (assertNotBlocked's 409).
      const taken = isOverlapViolation(error) || (error instanceof AppError && error.statusCode === 409);
      if (!taken) throw error;
      return openRefund(booking.id, amount, "HOLD_LAPSED", booking.driverId);
    }
  }

  if (booking.status === "CANCELLED") {
    return openRefund(booking.id, amount, "CANCELLED_BEFORE_PAYMENT", booking.driverId);
  }

  return "ALREADY_SETTLED";
}

/**
 * The whole payment back, for a booking that can't be honoured. Recorded as
 * REFUND_PENDING; sending it to the gateway is the Create Refund step. The
 * unique bookingId on Refund makes a second attempt a no-op.
 */
async function openRefund(
  bookingId: string,
  amount: Prisma.Decimal,
  policy: "HOLD_LAPSED" | "CANCELLED_BEFORE_PAYMENT" | "PAID_AFTER_STAY",
  driverId: string
): Promise<PaidOutcome> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.refund.create({ data: { bookingId, amount, policy } });
      // A booking that was still PENDING (a stay already over) is closed too,
      // so it never reads as a hold waiting on payment.
      await tx.booking.updateMany({ where: { id: bookingId, status: "PENDING" }, data: { status: "CANCELLED" } });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "ALREADY_SETTLED";
    throw error;
  }
  audit("PAYMENT_REFUND_OPENED", { bookingId, userId: driverId, amount: amount.toFixed(2), policy });
  return "REFUNDING";
}
