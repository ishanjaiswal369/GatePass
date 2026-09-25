import { Prisma } from "@prisma/client";
import { pricing } from "../config/pricing.js";
import { bookingRef } from "../lib/format.js";
import { addMonths, monthsEnded, occurrencesBetween } from "../lib/monthly.js";
import { prisma } from "../lib/prisma.js";
import { addDays, startOfVenueDay } from "../lib/venue-calendar.js";

/**
 * Monthly reservations as the host sees them (Phase 6), shaped like the
 * host's booking views so every host screen can list both side by side.
 *
 * Money: the host keeps the parking not refunded, less commission, like a
 * booking -- but it is *released* a month at a time, as each month of the
 * term ends, because a term is paid up front and "unused whole months" can
 * still be refunded. A cancelled term releases what it kept at once.
 */

export const termSelect = {
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
  vehicleNumber: true,
  vehicleType: true,
  driverId: true,
  createdAt: true,
  cancelledAt: true,
  listing: { select: { id: true, name: true } },
  driver: { select: { firstName: true, lastName: true } },
  refund: { select: { amount: true, policy: true } },
  settlementItems: { select: { amount: true, commissionDeducted: true, settlement: { select: { status: true } } } },
} satisfies Prisma.MonthlyReservationSelect;

export type TermRow = Prisma.MonthlyReservationGetPayload<{ select: typeof termSelect }>;

/** Paid terms on the host's spaces. An unpaid hold isn't a booking yet. */
export function paidTermsOn(hostProfileId: string, listingId?: string): Prisma.MonthlyReservationWhereInput {
  return { listing: { hostProfileId, ...(listingId ? { id: listingId } : {}) }, payment: { status: "CAPTURED" } };
}

export function termPhase(row: TermRow, now: Date): "UPCOMING" | "ACTIVE" | "COMPLETED" | "CANCELLED" {
  if (row.status === "CANCELLED") return "CANCELLED";
  if (row.status === "COMPLETED" || startOfVenueDay(row.endDate) <= now) return "COMPLETED";
  return startOfVenueDay(row.startDate) <= now ? "ACTIVE" : "UPCOMING";
}

export function termMoney(row: TermRow, now: Date) {
  const rate = 1 - pricing.hostCommissionRate;
  const kept = Prisma.Decimal.max(row.amount.sub(row.refund?.amount ?? 0), 0);
  const earning = kept.mul(rate).toDecimalPlaces(2);
  const releasable =
    row.status === "CANCELLED"
      ? earning
      : Prisma.Decimal.min(row.pricePerMonth.mul(monthsEnded(row.startDate, row.months, now)), kept).mul(rate).toDecimalPlaces(2);
  const paidOut = row.settlementItems
    .filter((i) => i.settlement.status === "PAID")
    .reduce((sum, i) => sum.add(i.amount.sub(i.commissionDeducted)), new Prisma.Decimal(0));
  const available = Prisma.Decimal.max(releasable.sub(paidOut), 0);
  const pending = Prisma.Decimal.max(earning.sub(releasable), 0);
  return { gross: row.amount, kept, earning, available, pending, paidOut };
}

function driverName(driver: { firstName: string | null; lastName: string | null }): string {
  const first = driver.firstName?.trim();
  if (!first) return "A driver";
  const initial = driver.lastName?.trim().charAt(0);
  return `${first}${initial ? ` ${initial.toUpperCase()}.` : ""}`;
}

/** A term as a host booking card: the whole term's span, its share, a Monthly badge. */
export function presentTerm(
  row: TermRow,
  labels: Map<string, string>,
  now: Date,
  span?: { start: Date; end: Date }
) {
  const money = termMoney(row, now);
  const phase = termPhase(row, now);
  const lastDay = addDays(row.endDate, -1);
  return {
    id: row.id,
    ref: bookingRef(row.id),
    listing: row.listing,
    phase,
    startsAt: span?.start ?? new Date(startOfVenueDay(row.startDate).getTime() + row.startMinute * 60_000),
    endsAt: span?.end ?? new Date(startOfVenueDay(lastDay).getTime() + row.endMinute * 60_000),
    driver: driverName(row.driver),
    vehicle: {
      number: row.vehicleNumber,
      type: row.vehicleType,
      label: labels.get(`${row.driverId}:${row.vehicleNumber}`) ?? null,
    },
    amount: money.gross.toString(),
    earning: money.earning.toString(),
    payout:
      money.pending.gt(0) ? ("PENDING" as const) : money.available.gt(0) ? ("AVAILABLE" as const) : money.paidOut.gt(0) ? ("PAID_OUT" as const) : ("NONE" as const),
    isNew: now.getTime() - row.createdAt.getTime() < 24 * 60 * 60_000,
    cancelledAt: row.cancelledAt,
    refundPolicy: row.refund?.policy ?? null,
    problem: null,
    monthly: {
      startDate: row.startDate,
      lastDate: lastDay,
      months: row.months,
      days: row.days,
      startMinute: row.startMinute,
      endMinute: row.endMinute,
    },
  };
}

/** Each occurrence of these terms inside [from, to), as its own card (today's list, the calendar). */
export function occurrenceViews(rows: TermRow[], from: Date, to: Date, labels: Map<string, string>, now: Date) {
  return rows.flatMap((row) =>
    row.status === "CANCELLED"
      ? []
      : occurrencesBetween(row, from, to).map((o) => {
          const view = presentTerm(row, labels, now, o);
          const phase = o.start <= now && now < o.end ? "ACTIVE" : o.end <= now ? "COMPLETED" : "UPCOMING";
          return { ...view, phase: phase as typeof view.phase };
        })
  );
}

/** The host's share from months of these terms that start inside [from, to): "this month". */
export function shareStartingBetween(row: TermRow, from: Date, to: Date) {
  const rate = 1 - pricing.hostCommissionRate;
  let gross = new Prisma.Decimal(0);
  if (row.status === "CANCELLED" && row.refund?.policy === "FULL") return { gross, net: gross };
  const refundedMonths = row.refund ? row.refund.amount.div(row.pricePerMonth).floor().toNumber() : 0;
  const keptMonths = row.months - refundedMonths;
  for (let i = 0; i < keptMonths; i++) {
    const start = startOfVenueDay(addMonths(row.startDate, i));
    if (start >= from && start < to) gross = gross.add(row.pricePerMonth);
  }
  return { gross, net: gross.mul(rate).toDecimalPlaces(2) };
}

export async function termsFor(where: Prisma.MonthlyReservationWhereInput) {
  return prisma.monthlyReservation.findMany({ where, select: termSelect, orderBy: { startDate: "asc" } });
}
