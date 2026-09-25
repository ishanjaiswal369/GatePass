import { Prisma } from "@prisma/client";
import { startTooFar } from "../lib/booking-rules.js";
import { coarsen } from "../lib/location-privacy.js";
import { pricing } from "../config/pricing.js";
import { BOOKABLE_SPOT } from "../lib/bookable-spot.js";
import { conflict, notFound } from "../lib/errors.js";
import { bookingRef, rupees } from "../lib/format.js";
import { lockListing } from "../lib/listing-lock.js";
import { activeTermWhere, addMonths, allOccurrences, monthsStarted, termOverlapsRange, termsOverlap, type Term } from "../lib/monthly.js";
import { termsTouching } from "../lib/monthly-guard.js";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/security-log.js";
import { monthlyFees } from "../lib/stay-price.js";
import { addDays, startOfVenueDay, venueDate } from "../lib/venue-calendar.js";
import { windowsCover } from "../lib/venue-time.js";
import { notify } from "./notification.service.js";

/**
 * Monthly reservations (Phase 6): the same hours on the same weekdays for
 * 1/3/6/12 months, paid once up front, never renewed automatically.
 *
 * Owned by the driver who made it -- `driverId` in every WHERE -- and priced
 * here from the spot's own monthly rate, never from the request. Claiming a
 * term runs inside the per-listing lock and checks every occurrence against
 * hourly bookings, other terms and host blocks; hourly paths check terms the
 * same way (lib/monthly-guard), so neither can slip past the other.
 */

const HOLD_MINUTES = 15;

export interface TermInput {
  vehicleType: string;
  startDate: string;
  months: number;
  days: number[];
  startMinute: number;
  endMinute: number;
}

function termOf(input: TermInput): Term {
  return {
    days: [...new Set(input.days)].sort(),
    startMinute: input.startMinute,
    endMinute: input.endMinute,
    startDate: input.startDate,
    endDate: addMonths(input.startDate, input.months),
  };
}

/**
 * Why these listings can't hold this term, per listing; a listing absent
 * from the result is free for all of it. Shared by search (many listings),
 * the quote and the reservation itself (one, inside the lock).
 */
export async function termConflicts(
  db: Prisma.TransactionClient,
  listingIds: string[],
  term: Term,
  now = new Date()
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (listingIds.length === 0) return out;
  const from = startOfVenueDay(term.startDate);
  const to = startOfVenueDay(term.endDate);

  const [bookings, blocks, terms] = await Promise.all([
    db.booking.findMany({
      where: {
        listingId: { in: listingIds },
        startsAt: { lt: to },
        endsAt: { gt: from },
        OR: [{ status: "CONFIRMED" }, { status: "PENDING", holdExpiresAt: { gt: now } }],
      },
      select: { listingId: true, startsAt: true, endsAt: true },
    }),
    db.listingBlock.findMany({
      where: { listingId: { in: listingIds }, startsAt: { lt: to }, endsAt: { gt: from } },
      select: { listingId: true, startsAt: true, endsAt: true },
    }),
    termsTouching(db, listingIds, from, to, now),
  ]);

  for (const t of terms) {
    if (!out.has(t.listingId) && termsOverlap(t, term)) out.set(t.listingId, "Another driver has this space monthly for some of those hours.");
  }
  for (const b of bookings) {
    if (!out.has(b.listingId!) && termOverlapsRange(term, b.startsAt!, b.endsAt!)) {
      out.set(b.listingId!, "Someone has booked this space for part of your term.");
    }
  }
  for (const b of blocks) {
    if (!out.has(b.listingId) && termOverlapsRange(term, b.startsAt, b.endsAt)) {
      out.set(b.listingId, "The host has blocked some of the dates in your term.");
    }
  }
  return out;
}

/** The spot's terms for this reservation: gates, hours, rate. Refusals as a reason string. */
async function assess(db: Prisma.TransactionClient, listingId: string, input: TermInput) {
  const spot = await db.listing.findFirst({
    where: { id: listingId, ...BOOKABLE_SPOT },
    select: {
      bookingsPausedAt: true,
      advanceDays: true,
      availability: { where: { isActive: true }, select: { dayOfWeek: true, startMinute: true, endMinute: true } },
      pricing: { where: { vehicleType: input.vehicleType }, select: { pricePerMonth: true } },
    },
  });
  if (!spot) throw notFound("Spot not found");

  const term = termOf(input);
  const rate = spot.pricing[0]?.pricePerMonth ?? null;
  let reason: string | null = null;
  // The host's advance-booking rule; their stay-length rules are for hourly stays.
  const tooFar = startTooFar(spot, startOfVenueDay(term.startDate));

  if (spot.bookingsPausedAt) reason = "This space isn't taking new bookings right now.";
  else if (!rate) reason = "This space doesn't offer monthly parking for that vehicle.";
  else if (tooFar) reason = tooFar;
  else {
    // Open for the whole daily window on every chosen weekday. A term is at
    // least a month, so its first seven days hold each chosen weekday once,
    // and the weekly hours repeat -- checking that week checks them all.
    const firstWeek = allOccurrences({ ...term, endDate: addDays(term.startDate, 7) });
    if (firstWeek.length !== term.days.length || !firstWeek.every((o) => windowsCover(spot.availability, o.start, o.end))) {
      reason = "The space isn't open for those hours on every day you chose.";
    }
  }

  const amount = rate ? rate.mul(input.months) : new Prisma.Decimal(0);
  const { platformFee, taxAmount } = monthlyFees(amount);
  return { term, rate, amount, platformFee, taxAmount, reason };
}

export async function quote(listingId: string, input: TermInput) {
  const a = await assess(prisma, listingId, input);
  const reason = a.reason ?? (await termConflicts(prisma, [listingId], a.term)).get(listingId) ?? null;
  return {
    available: reason === null,
    reason,
    startDate: a.term.startDate,
    /** The last day of the term, inclusive, for display. */
    lastDate: addDays(a.term.endDate, -1),
    months: input.months,
    pricePerMonth: a.rate?.toString() ?? null,
    parking: a.amount.toString(),
    platformFee: a.platformFee.toString(),
    platformFeeRate: pricing.monthlyPlatformFeeRate,
    taxAmount: a.taxAmount.toString(),
    total: a.amount.add(a.platformFee).add(a.taxAmount).toString(),
    occurrences: allOccurrences(a.term).length,
  };
}

const reservationView = {
  id: true,
  status: true,
  days: true,
  startMinute: true,
  endMinute: true,
  startDate: true,
  endDate: true,
  months: true,
  pricePerMonth: true,
  amount: true,
  platformFee: true,
  taxAmount: true,
  vehicleNumber: true,
  vehicleType: true,
  holdExpiresAt: true,
  cancelledAt: true,
  createdAt: true,
  listing: {
    select: { id: true, name: true, addressLine: true, area: true, city: true, latitude: true, longitude: true, entryPoint: true },
  },
  payment: { select: { status: true, amount: true } },
  refund: { select: { amount: true, status: true, policy: true, createdAt: true } },
} satisfies Prisma.MonthlyReservationSelect;

type ReservationRow = Prisma.MonthlyReservationGetPayload<{ select: typeof reservationView }>;

function phaseOf(row: ReservationRow, now: Date) {
  if (row.status === "CANCELLED") return "CANCELLED" as const;
  if (row.status === "PENDING") return row.holdExpiresAt && row.holdExpiresAt <= now ? ("EXPIRED" as const) : ("PENDING" as const);
  if (row.status === "COMPLETED" || startOfVenueDay(row.endDate) <= now) return "COMPLETED" as const;
  return startOfVenueDay(row.startDate) <= now ? ("ACTIVE" as const) : ("UPCOMING" as const);
}

function present(row: ReservationRow, now = new Date()) {
  // The street line and exact pin come with payment, as for a stay.
  const paid = row.payment?.status === "CAPTURED";
  const listing = paid ? row.listing : coarsen(row.listing);
  return { ...row, listing, lastDate: addDays(row.endDate, -1), phase: phaseOf(row, now), ref: bookingRef(row.id) };
}

export async function create(
  driverId: string,
  input: TermInput & { listingId: string; vehicleNumber: string; idempotencyKey: string }
) {
  const created = await prisma.$transaction(async (tx) => {
    const existing = await tx.monthlyReservation.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { ...reservationView, driverId: true },
    });
    if (existing) {
      if (existing.driverId !== driverId) throw conflict("Idempotency key already used");
      const { driverId: _d, ...row } = existing;
      return { row, replayed: true };
    }

    await lockListing(tx, input.listingId);
    // A lapsed hold stops claiming its hours now, not at some later sweep.
    await tx.monthlyReservation.updateMany({
      where: { listingId: input.listingId, status: "PENDING", holdExpiresAt: { lt: new Date() } },
      data: { status: "CANCELLED" },
    });

    const a = await assess(tx, input.listingId, input);
    if (a.reason) throw conflict(a.reason);
    const taken = (await termConflicts(tx, [input.listingId], a.term)).get(input.listingId);
    if (taken) throw conflict(taken);

    const row = await tx.monthlyReservation.create({
      data: {
        listingId: input.listingId,
        driverId,
        vehicleNumber: input.vehicleNumber,
        vehicleType: input.vehicleType,
        ...a.term,
        months: input.months,
        pricePerMonth: a.rate!,
        amount: a.amount,
        platformFee: a.platformFee,
        taxAmount: a.taxAmount,
        holdExpiresAt: new Date(Date.now() + HOLD_MINUTES * 60_000),
        idempotencyKey: input.idempotencyKey,
      },
      select: reservationView,
    });
    return { row, replayed: false };
  });

  if (!created.replayed) audit("MONTHLY_HELD", { userId: driverId, reservationId: created.row.id, listingId: input.listingId, months: input.months });
  return { reservation: present(created.row), replayed: created.replayed };
}

/** Terms whose last day has passed are recorded as finished when looked at -- the same lazy sweep as stays. */
async function completeEnded(driverId: string, now: Date) {
  await prisma.monthlyReservation.updateMany({
    where: { driverId, status: "CONFIRMED", endDate: { lte: venueDate(now) } },
    data: { status: "COMPLETED" },
  });
}

export async function listForDriver(driverId: string, scope: "current" | "past") {
  const now = new Date();
  await completeEnded(driverId, now);
  const rows = await prisma.monthlyReservation.findMany({
    where: {
      driverId,
      ...(scope === "current"
        ? activeTermWhere(now)
        : { NOT: activeTermWhere(now) }),
    },
    select: reservationView,
    orderBy: scope === "current" ? { startDate: "asc" } : { createdAt: "desc" },
    take: 50,
  });
  return { items: rows.map((row) => present(row, now)) };
}

export async function getForDriver(id: string, driverId: string) {
  const row = await prisma.monthlyReservation.findFirst({
    where: { id, driverId },
    select: {
      ...reservationView,
      listing: { select: { ...reservationView.listing.select, accessInstructions: true, bayNumber: true, parkingMarker: true } },
    },
  });
  if (!row) throw notFound("Reservation not found");
  const { listing, ...rest } = row;
  const { accessInstructions, bayNumber, parkingMarker, ...publicListing } = listing;
  const paid = row.payment?.status === "CAPTURED" && (row.status === "CONFIRMED" || row.status === "COMPLETED");
  return { ...present({ ...rest, listing: publicListing }), access: paid ? { accessInstructions, bayNumber, parkingMarker } : null };
}

/**
 * The monthly cancellation policy (prototype): before the term starts,
 * everything paid comes back; after, the parking for whole months not yet
 * begun (the fee isn't refunded); an unpaid hold just ends.
 */
function assessCancel(row: ReservationRow, now: Date) {
  const phase = phaseOf(row, now);
  const paid = row.payment?.status === "CAPTURED";
  if (phase === "CANCELLED" || phase === "EXPIRED") return { cancellable: false, reason: "This reservation has already ended.", refund: new Prisma.Decimal(0), rule: null };
  if (phase === "COMPLETED") return { cancellable: false, reason: "This term has finished.", refund: new Prisma.Decimal(0), rule: null };
  if (!paid) return { cancellable: true, reason: null, refund: new Prisma.Decimal(0), rule: "NOTHING_PAID" as const };
  if (phase === "UPCOMING") return { cancellable: true, reason: null, refund: row.payment!.amount, rule: "FULL" as const };
  const unused = row.months - monthsStarted(row.startDate, row.months, now);
  if (unused <= 0) return { cancellable: false, reason: "Your last month has already started, so there's nothing left to refund.", refund: new Prisma.Decimal(0), rule: null };
  return { cancellable: true, reason: null, refund: row.pricePerMonth.mul(unused), rule: "UNUSED_MONTHS" as const, unused };
}

export async function cancellationQuote(id: string, driverId: string) {
  const row = await prisma.monthlyReservation.findFirst({ where: { id, driverId }, select: reservationView });
  if (!row) throw notFound("Reservation not found");
  const a = assessCancel(row, new Date());
  return { cancellable: a.cancellable, reason: a.reason, rule: a.rule, refundAmount: a.refund.toString(), unusedMonths: "unused" in a ? a.unused : null };
}

export async function cancel(id: string, driverId: string, reason?: string) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const row = await tx.monthlyReservation.findFirst({ where: { id, driverId }, select: reservationView });
    if (!row) throw notFound("Reservation not found");
    if (row.status === "CANCELLED") return;
    const a = assessCancel(row, now);
    if (!a.cancellable) throw conflict(a.reason ?? "This reservation can't be cancelled");

    const changed = await tx.monthlyReservation.updateMany({
      where: { id, driverId, status: row.status },
      data: { status: "CANCELLED", cancelledAt: now, cancellationReason: reason ?? null },
    });
    if (changed.count === 0) throw conflict("This reservation changed. Refresh and try again.");

    if (a.refund.greaterThan(0)) {
      await tx.refund.create({ data: { monthlyReservationId: id, amount: a.refund, policy: a.rule! } });
    }
    await notify(
      driverId,
      "BOOKING_CANCELLED",
      {
        title: `Monthly parking cancelled · ${bookingRef(id)}`,
        body: a.refund.greaterThan(0)
          ? `Refund of ${rupees(a.refund)} started. Usually 5–7 working days, depending on your bank.`
          : "Nothing was charged, so there's nothing to refund.",
        listingId: row.listing.id,
        dedupeKey: `mcancelled:${id}`,
      },
      tx
    );
    audit("MONTHLY_CANCELLED", { userId: driverId, reservationId: id, refund: a.refund.toString(), rule: a.rule });
  });
  return getForDriver(id, driverId);
}
