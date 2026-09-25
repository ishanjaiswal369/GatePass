import { Prisma } from "@prisma/client";
import { cancellationPolicy } from "../config/pricing.js";
import { conflict, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/security-log.js";
import { bookingRef, rupees } from "../lib/format.js";
import { notify } from "./notification.service.js";
import { getForDriver } from "./booking.service.js";

/**
 * Cancelling a booking, and what comes back.
 *
 * The quote and the cancellation run the same policy function over the same
 * row, so the amount a driver is shown is the amount they get -- the quote is
 * never a separate estimate that could drift from what `cancel` does.
 */

export type RefundRule = "FULL" | "LATE" | "NOTHING_PAID";

export interface CancellationQuote {
  cancellable: boolean;
  /** Why not, when it is not. */
  reason: string | null;
  rule: RefundRule | null;
  refundAmount: string;
  paidAmount: string;
  /** Until when cancelling returns everything. Null when there is no start time. */
  freeUntil: Date | null;
}

const cancellationRow = {
  id: true,
  status: true,
  amount: true,
  quantity: true,
  startsAt: true,
  parkingCapacityId: true,
  extendsBookingId: true,
  payment: { select: { status: true, amount: true } },
  parkingCapacity: { select: { listing: { select: { eventDate: true } } } },
} satisfies Prisma.BookingSelect;

type CancellationRow = Prisma.BookingGetPayload<{ select: typeof cancellationRow }>;

const ZERO = new Prisma.Decimal(0);

function startOf(row: CancellationRow): Date | null {
  return row.startsAt ?? row.parkingCapacity?.listing.eventDate ?? null;
}

/**
 * The policy, applied. Pure: the same row and clock always give the same
 * answer, which is what makes the quote trustworthy.
 */
function assess(row: CancellationRow, now: Date): CancellationQuote & { refund: Prisma.Decimal } {
  const start = startOf(row);
  const freeUntil = start
    ? new Date(start.getTime() - cancellationPolicy.freeUntilMinutesBefore * 60_000)
    : null;

  // Only money that actually arrived can go back. Until payments are wired
  // no booking has any, so every cancellation is a plain release of the hold.
  const paid = row.payment?.status === "CAPTURED" ? row.payment.amount : ZERO;

  const refuse = (reason: string): CancellationQuote & { refund: Prisma.Decimal } => ({
    cancellable: false,
    reason,
    rule: null,
    refundAmount: "0",
    paidAmount: paid.toString(),
    freeUntil,
    refund: ZERO,
  });

  if (row.extendsBookingId) {
    return refuse("Extra time can't be cancelled on its own.");
  }
  if (row.status === "CANCELLED") return refuse("This booking is already cancelled.");
  if (row.status !== "PENDING" && row.status !== "CONFIRMED") {
    return refuse("This booking has already finished.");
  }
  if (start && now >= start) {
    return refuse(
      "This booking has already started. If you can't use the space, report a problem instead."
    );
  }

  let rule: RefundRule;
  let refund: Prisma.Decimal;

  if (paid.isZero()) {
    rule = "NOTHING_PAID";
    refund = ZERO;
  } else if (!freeUntil || now < freeUntil) {
    rule = "FULL";
    refund = paid;
  } else {
    // Late: part of the parking comes back, the platform fee does not.
    rule = "LATE";
    const share = row.amount.mul(cancellationPolicy.lateRefundRate).toDecimalPlaces(2);
    refund = Prisma.Decimal.min(share, paid);
  }

  return {
    cancellable: true,
    reason: null,
    rule,
    refundAmount: refund.toString(),
    paidAmount: paid.toString(),
    freeUntil,
    refund,
  };
}

async function loadOwned(bookingId: string, driverId: string): Promise<CancellationRow> {
  // Owner in the filter, so a booking that is not yours reads as missing.
  const row = await prisma.booking.findFirst({
    where: { id: bookingId, driverId },
    select: cancellationRow,
  });

  if (!row) throw notFound("Booking not found");
  return row;
}

export async function quote(bookingId: string, driverId: string): Promise<CancellationQuote> {
  const { refund: _refund, ...shown } = assess(await loadOwned(bookingId, driverId), new Date());
  return shown;
}

/**
 * Cancels a booking and, when money was paid, opens its refund.
 *
 * The status change is one conditional statement, so two taps -- or a retry
 * after a dropped response -- cannot cancel twice or open two refunds: the
 * second finds nothing left to change and gets the already-cancelled booking
 * back. The unique bookingId on Refund is the backstop.
 */
export async function cancel(bookingId: string, driverId: string, reason?: string) {
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const row = await tx.booking.findFirst({
      where: { id: bookingId, driverId },
      select: cancellationRow,
    });

    if (!row) throw notFound("Booking not found");

    // Asked again after it already went through: answer with what happened.
    if (row.status === "CANCELLED") return;

    const outcome = assess(row, now);
    if (!outcome.cancellable) throw conflict(outcome.reason ?? "This booking can't be cancelled");

    const changed = await tx.booking.updateMany({
      where: { id: row.id, driverId, status: row.status },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        cancellationReason: reason ?? null,
        updatedBy: driverId,
      },
    });

    // Something else moved it between the read and this write.
    if (changed.count === 0) throw conflict("This booking changed. Refresh and try again.");

    // An event booking gave back a slot from a counted capacity.
    if (row.parkingCapacityId) {
      await tx.$executeRaw`
        UPDATE "ParkingCapacity"
        SET "bookedCount" = GREATEST("bookedCount" - ${row.quantity}, 0), "updatedAt" = NOW()
        WHERE "id" = ${row.parkingCapacityId}
      `;
    }

    if (outcome.refund.greaterThan(0)) {
      await tx.refund.create({
        data: { bookingId: row.id, amount: outcome.refund, policy: outcome.rule! },
      });
    }

    await notify(
      driverId,
      "BOOKING_CANCELLED",
      {
        title: `Booking cancelled · ${bookingRef(row.id)}`,
        body: outcome.refund.greaterThan(0)
          ? `Refund of ${rupees(outcome.refund)} started. Usually 5–7 working days, depending on your bank.`
          : "Nothing was charged, so there's nothing to refund.",
        bookingId: row.id,
        dedupeKey: `cancelled:${row.id}`,
      },
      tx
    );

    audit("BOOKING_CANCELLED", {
      userId: driverId,
      bookingId: row.id,
      refund: outcome.refund.toString(),
      rule: outcome.rule,
    });
  });

  return getForDriver(bookingId, driverId);
}
