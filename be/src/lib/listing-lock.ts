import { Prisma } from "@prisma/client";
import { conflict } from "./errors.js";

/**
 * One writer at a time per listing's calendar, for the rest of a transaction.
 *
 * The Booking_no_overlap EXCLUDE settles booking against booking by itself.
 * It can't see a host's blocks (Phase 5) or monthly reservations (Phase 6),
 * so those are checked in code -- and a check in code is only as good as
 * nothing changing between the check and the insert. Every path that claims
 * time on a listing takes this lock first: two bookings, a booking and a
 * block, or a block and a monthly reservation then run one after the other
 * instead of both reading "free".
 *
 * Transaction-scoped (pg_advisory_xact_lock): released at commit or rollback,
 * so nothing can leak a held lock.
 */
export async function lockListing(tx: Prisma.TransactionClient, listingId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`listing:${listingId}`}, 0))`;
}

/**
 * Refuses a claim on hours the host has blocked. Call after `lockListing`,
 * inside the same transaction.
 */
export async function assertNotBlocked(
  tx: Prisma.TransactionClient,
  listingId: string,
  startsAt: Date,
  endsAt: Date
): Promise<void> {
  const block = await tx.listingBlock.findFirst({
    where: { listingId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
    select: { id: true },
  });
  if (block) throw conflict("The host has blocked some of those hours. Try a different time.");
}
