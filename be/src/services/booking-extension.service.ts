import { Prisma } from "@prisma/client";
import { EXTENSION_STEPS } from "../config/pricing.js";
import { conflict, notFound } from "../lib/errors.js";
import { assertNotBlocked, lockListing } from "../lib/listing-lock.js";
import { assertNoMonthlyConflict, termClaiming } from "../lib/monthly-guard.js";
import { occurrencesBetween } from "../lib/monthly.js";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/security-log.js";
import { venueDayAndMinute, windowsCover, type WeeklyWindow } from "../lib/venue-time.js";
import {
  HOLD_MINUTES,
  generateQrToken,
  getForDriver,
  isOverlapViolation,
  releaseExpiredHolds,
} from "./booking.service.js";

/**
 * Staying longer on a spot the driver is parked on.
 *
 * Extra time is sold as a booking of its own -- a PENDING hold on the same
 * spot from the current end, linked back by `extendsBookingId` -- rather than
 * by moving the parked booking's `endsAt`. That way the overlap guard holds
 * the extra hours while they are being paid for, an unpaid extension lapses
 * like any other hold, and the time is never handed out for free.
 */

const parentRow = {
  id: true,
  status: true,
  listingId: true,
  startsAt: true,
  endsAt: true,
  vehicleType: true,
  vehicleNumber: true,
  extendsBookingId: true,
  extensions: {
    where: { status: { in: ["PENDING", "CONFIRMED"] } },
    select: { id: true, status: true, endsAt: true, holdExpiresAt: true, amount: true },
  },
} satisfies Prisma.BookingSelect;

type ParentRow = Prisma.BookingGetPayload<{ select: typeof parentRow }>;

interface SpotTerms {
  availability: WeeklyWindow[];
  pricePerHour: Prisma.Decimal;
}

function currentEnd(row: ParentRow): Date {
  return row.extensions
    .filter((extension) => extension.status === "CONFIRMED" && extension.endsAt)
    .reduce<Date>((latest, e) => (e.endsAt! > latest ? e.endsAt! : latest), row.endsAt!);
}

function pendingExtension(row: ParentRow, now: Date) {
  return (
    row.extensions.find(
      (e) => e.status === "PENDING" && e.holdExpiresAt !== null && e.holdExpiresAt > now
    ) ?? null
  );
}

/**
 * Loads the driver's own booking and checks it can take more time: a paid
 * spot stay that is running now. Extending before arrival is not offered --
 * that is changing the booking, not staying longer.
 */
async function loadRunning(
  db: Prisma.TransactionClient | typeof prisma,
  bookingId: string,
  driverId: string,
  now: Date
): Promise<{ row: ParentRow; end: Date }> {
  const row = await db.booking.findFirst({
    where: { id: bookingId, driverId },
    select: parentRow,
  });

  if (!row || !row.listingId || !row.startsAt || !row.endsAt || row.extendsBookingId) {
    throw notFound("Booking not found");
  }

  const end = currentEnd(row);

  if (row.status !== "CONFIRMED" || now < row.startsAt || now >= end) {
    throw conflict("Only a parking session that is running now can be extended.");
  }

  return { row, end };
}

async function loadTerms(listingId: string, vehicleType: string | null): Promise<SpotTerms> {
  const spot = await prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      availability: {
        where: { isActive: true },
        select: { dayOfWeek: true, startMinute: true, endMinute: true },
      },
      pricing: { select: { vehicleType: true, pricePerHour: true } },
    },
  });

  const rate = spot?.pricing.find((row) => row.vehicleType === vehicleType);
  if (!spot || !rate) throw conflict("This space can no longer be extended.");

  return { availability: spot.availability, pricePerHour: rate.pricePerHour };
}

function priceFor(terms: SpotTerms, minutes: number): Prisma.Decimal {
  return terms.pricePerHour.mul(minutes).div(60).toDecimalPlaces(2);
}

/** "6:00 PM" at the venue -- the same shape the app prints times in. */
function clock(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
  });
}

export interface ExtensionOption {
  minutes: number;
  endsAt: Date;
  amount: string;
  available: boolean;
  /** Why not, in words a driver can act on. */
  reason: string | null;
}

export async function options(bookingId: string, driverId: string) {
  const now = new Date();
  const { row, end } = await loadRunning(prisma, bookingId, driverId, now);
  const terms = await loadTerms(row.listingId!, row.vehicleType);

  // The first thing after this stay that holds the space: another driver's
  // booking (paid, or a hold still being paid for).
  const next = await prisma.booking.findFirst({
    where: {
      listingId: row.listingId,
      id: { not: row.id },
      startsAt: { gte: end },
      AND: [
        // This stay's own extra time is not "another driver". Spelled out,
        // because `{ not: id }` on a nullable column is SQL `<>`, which also
        // drops every row where it is NULL -- i.e. every ordinary booking.
        { OR: [{ extendsBookingId: null }, { extendsBookingId: { not: row.id } }] },
        { OR: [{ status: "CONFIRMED" }, { status: "PENDING", holdExpiresAt: { gt: now } }] },
      ],
    },
    select: { startsAt: true },
    orderBy: { startsAt: "asc" },
  });

  // Or the host taking the hours after it off sale.
  const nextBlock = await prisma.listingBlock.findFirst({
    where: { listingId: row.listingId!, endsAt: { gt: end } },
    select: { startsAt: true },
    orderBy: { startsAt: "asc" },
  });

  // Or a monthly reservation's next occurrence, within the longest step.
  const longest = new Date(end.getTime() + Math.max(...EXTENSION_STEPS) * 60_000);
  const claiming = await termClaiming(prisma, row.listingId!, end, longest);
  const monthlyAfter = claiming
    ? occurrencesBetween(claiming, end, longest).map((o) => (o.start < end ? end : o.start)).sort((a, b) => a.getTime() - b.getTime())[0] ?? null
    : null;

  const opts: ExtensionOption[] = EXTENSION_STEPS.map((minutes) => {
    const endsAt = new Date(end.getTime() + minutes * 60_000);
    let reason: string | null = null;

    if (next?.startsAt && next.startsAt < endsAt) {
      reason = `This space is booked from ${clock(next.startsAt)}.`;
    } else if (monthlyAfter && monthlyAfter < endsAt) {
      reason = `This space is reserved monthly from ${clock(monthlyAfter)}.`;
    } else if (nextBlock && nextBlock.startsAt < endsAt) {
      reason = nextBlock.startsAt <= end
        ? "The host has blocked the time after your booking."
        : `The host has blocked the space from ${clock(nextBlock.startsAt)}.`;
    } else if (!windowsCover(terms.availability, end, endsAt)) {
      const { dayOfWeek, minute } = venueDayAndMinute(end);
      const window = terms.availability.find(
        (w) => w.dayOfWeek === dayOfWeek && w.startMinute <= minute && w.endMinute > minute
      );
      reason = window
        ? `The space closes at ${clock(new Date(end.getTime() + (window.endMinute - minute) * 60_000))}.`
        : "The space closes when your booking ends.";
    }

    return { minutes, endsAt, amount: priceFor(terms, minutes).toString(), available: reason === null, reason };
  });

  const pending = pendingExtension(row, now);

  return {
    currentEndsAt: end,
    /** Extra time already chosen and waiting for payment, if any. */
    pending: pending
      ? { id: pending.id, endsAt: pending.endsAt, amount: pending.amount.toString(), holdExpiresAt: pending.holdExpiresAt }
      : null,
    /** The latest the space could be kept until, when something stops it. */
    unavailableAfter: opts.find((o) => !o.available) ? opts.filter((o) => o.available).at(-1)?.endsAt ?? end : null,
    options: opts,
  };
}

/**
 * Holds the extra time for the driver to pay for.
 *
 * Replays by idempotency key like any booking. The overlap guard is what
 * refuses time that another driver holds; the checks before it only turn the
 * common cases into a clear message.
 */
export async function create(
  bookingId: string,
  driverId: string,
  input: { minutes: number; idempotencyKey: string }
) {
  const now = new Date();

  try {
    const extensionId = await prisma.$transaction(async (tx) => {
      const existing = await tx.booking.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true, driverId: true, extendsBookingId: true },
      });

      if (existing) {
        if (existing.driverId !== driverId || existing.extendsBookingId !== bookingId) {
          throw conflict("Idempotency key already used");
        }
        return existing.id;
      }

      const { row, end } = await loadRunning(tx, bookingId, driverId, now);

      await lockListing(tx, row.listingId!);
      await releaseExpiredHolds(tx, row.listingId!);

      if (pendingExtension(row, now)) {
        throw conflict("You already have extra time waiting for payment.");
      }

      const terms = await loadTerms(row.listingId!, row.vehicleType);
      const endsAt = new Date(end.getTime() + input.minutes * 60_000);

      if (!windowsCover(terms.availability, end, endsAt)) {
        throw conflict("The space isn't open for that long.");
      }
      await assertNotBlocked(tx, row.listingId!, end, endsAt);
      await assertNoMonthlyConflict(tx, row.listingId!, end, endsAt);

      const created = await tx.booking.create({
        data: {
          listingId: row.listingId,
          extendsBookingId: row.id,
          startsAt: end,
          endsAt,
          holdExpiresAt: new Date(now.getTime() + HOLD_MINUTES * 60_000),
          driverId,
          vehicleNumber: row.vehicleNumber,
          vehicleType: row.vehicleType,
          quantity: 1,
          amount: priceFor(terms, input.minutes),
          idempotencyKey: input.idempotencyKey,
          qrToken: generateQrToken(),
          createdBy: driverId,
          updatedBy: driverId,
        },
        select: { id: true },
      });

      audit("EXTENSION_HELD", { userId: driverId, bookingId: row.id, extensionId: created.id, minutes: input.minutes });
      return created.id;
    });

    return { extensionId, booking: await getForDriver(bookingId, driverId) };
  } catch (error) {
    if (isOverlapViolation(error)) {
      throw conflict("Another driver has booked this space for part of that time.");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw conflict("Idempotency key already used");
    }
    throw error;
  }
}
