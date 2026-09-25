import type { Prisma } from "@prisma/client";
import { conflict } from "./errors.js";
import { activeTermWhere, termOverlapsRange, type Term } from "./monthly.js";
import { venueDate } from "./venue-calendar.js";

const termSelect = {
  id: true,
  days: true,
  startMinute: true,
  endMinute: true,
  startDate: true,
  endDate: true,
  driver: { select: { firstName: true, lastName: true } },
} satisfies Prisma.MonthlyReservationSelect;

export type TermRow = Prisma.MonthlyReservationGetPayload<{ select: typeof termSelect }>;

/**
 * Monthly terms on a listing that are live (paid, or a hold not yet lapsed)
 * and whose dates touch [from, to). Candidates only -- whether a weekday and
 * the hours actually meet is lib/monthly's job.
 */
export async function termsTouching(
  db: Prisma.TransactionClient,
  listingIds: string[],
  from: Date,
  to: Date,
  now = new Date()
): Promise<(TermRow & { listingId: string })[]> {
  if (listingIds.length === 0) return [];
  return db.monthlyReservation.findMany({
    where: {
      listingId: { in: listingIds },
      startDate: { lte: venueDate(to) },
      endDate: { gt: venueDate(from) },
      ...activeTermWhere(now),
    },
    select: { ...termSelect, listingId: true },
  });
}

/** The first live term that claims part of [start, end), if any. */
export async function termClaiming(
  db: Prisma.TransactionClient,
  listingId: string,
  start: Date,
  end: Date
): Promise<TermRow | null> {
  const terms = await termsTouching(db, [listingId], start, end);
  return terms.find((term) => termOverlapsRange(term as Term, start, end)) ?? null;
}

/**
 * Refuses an hourly claim on hours a monthly reservation holds. Call inside
 * the listing lock, like assertNotBlocked, so a term being reserved at the
 * same moment can't slip between the check and the insert.
 */
export async function assertNoMonthlyConflict(
  tx: Prisma.TransactionClient,
  listingId: string,
  start: Date,
  end: Date
): Promise<void> {
  if (await termClaiming(tx, listingId, start, end)) {
    throw conflict("This space is reserved monthly for some of those hours. Try a different time.");
  }
}
