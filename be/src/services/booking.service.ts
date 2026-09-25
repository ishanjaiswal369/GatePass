import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { conflict, badRequest, notFound } from "../lib/errors.js";
import {
  DEFAULT_PAGE_SIZE,
  type Page,
  decodeCursor,
  encodeCursor,
} from "../lib/pagination.js";
import { assertNotBlocked, lockListing } from "../lib/listing-lock.js";
import { assertNoMonthlyConflict } from "../lib/monthly-guard.js";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/security-log.js";
import { driverFees, stayPrice } from "../lib/stay-price.js";
import { windowsCover } from "../lib/venue-time.js";
import * as passService from "./pass.service.js";

export interface CreateBookingInput {
  parkingCapacityId: string;
  vehicleNumber: string;
  quantity: number;
  idempotencyKey: string;
}

export type BookingScope = "upcoming" | "active" | "past";

/** Listing states a driver is allowed to book into. */
const BOOKABLE_LISTING_STATUSES = ["PUBLISHED", "ONGOING"];

/**
 * How long after an event starts its pass still counts as "upcoming". Covers
 * a driver who arrives late and still needs the QR at the gate.
 */
const PASS_GRACE_MS = 12 * 60 * 60 * 1000;

/**
 * 32 random bytes, so the token cannot be guessed from a booking id or from
 * another driver's pass. It is the durable secret behind a pass; the short
 * lived token the app displays is derived from it in pass.service.
 */
export function generateQrToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The projection every driver-facing booking response is built from.
 *
 * Both shapes are selected because a driver's list holds both: an event
 * booking reaches its listing through ParkingCapacity, a host-spot booking
 * carries its own plus the hours it covers. Exactly one side is ever
 * populated -- a DB CHECK enforces that -- so a reader picks whichever is
 * not null rather than branching on a type flag.
 *
 * Access instructions are deliberately NOT here. They are worth money and are
 * released only on a paid booking, by `getForDriver`.
 */
const bookingView = {
  id: true,
  quantity: true,
  amount: true,
  platformFee: true,
  taxAmount: true,
  status: true,
  vehicleNumber: true,
  // Only a host-spot booking carries these. `vehicleType` is on the booking
  // because a spot has no ParkingCapacity to read it from, and
  // `holdExpiresAt` is here because an unpaid hold that silently lapses is
  // worse than one the driver can watch running out.
  vehicleType: true,
  holdExpiresAt: true,
  cancelledAt: true,
  createdAt: true,
  startsAt: true,
  endsAt: true,
  listing: {
    select: {
      id: true,
      name: true,
      venueName: true,
      addressLine: true,
      city: true,
      latitude: true,
      longitude: true,
      eventDate: true,
      listingType: true,
      status: true,
      // The cover, for the Rate screen and the booking header.
      photos: { select: { url: true }, orderBy: { position: "asc" }, take: 1 },
    },
  },
  parkingCapacity: {
    select: {
      id: true,
      vehicleType: true,
      gate: true,
      price: true,
      listing: {
        select: {
          id: true,
          name: true,
          venueName: true,
          eventDate: true,
          listingType: true,
          status: true,
        },
      },
    },
  },
  // Money state, each on its own: whether it was paid, and whether any of it
  // is on its way back. Only what the driver needs to read -- no gateway ids.
  payment: { select: { status: true, amount: true } },
  // The driver's own rating of the stay, once given. Only the stars and
  // when: the words are theirs and are shown on the spot, not here.
  review: { select: { rating: true, createdAt: true } },
  // A report against this stay: "Under review" while open. Not its details --
  // those are on the report's own screen.
  problem: { select: { id: true, category: true, status: true, refunded: true, createdAt: true } },
  // Read for `canReview` -- extra time is not a stay of its own.
  extendsBookingId: true,
  refund: {
    select: {
      amount: true,
      status: true,
      policy: true,
      reference: true,
      createdAt: true,
      processedAt: true,
    },
  },
  // Extra time bought on the same spot. Lapsed and cancelled attempts are
  // left out: they never changed when the driver has to leave.
  extensions: {
    where: { status: { in: ["PENDING", "CONFIRMED"] } },
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
      amount: true,
      holdExpiresAt: true,
    },
    orderBy: { endsAt: "asc" },
  },
} satisfies Prisma.BookingSelect;

type BookingRow = Prisma.BookingGetPayload<{ select: typeof bookingView }>;

/** The same projection plus the owner, for checks that must not be returned. */
const bookingViewWithOwner = { ...bookingView, driverId: true } satisfies Prisma.BookingSelect;

/**
 * Where a booking is in its life, as the driver sees it.
 *
 * Derived rather than stored. ACTIVE in particular cannot be a stored status:
 * the EXCLUDE constraint that stops two drivers booking the same hours covers
 * PENDING and CONFIRMED only, so a stored ACTIVE would take a parked car's
 * booking out of it and let the rest of its hours be sold again.
 */
export type BookingPhase =
  | "PENDING"
  | "EXPIRED"
  | "UPCOMING"
  | "ACTIVE"
  | "COMPLETED"
  | "CANCELLED";

export type BookingView = BookingRow & {
  phase: BookingPhase;
  /** When the driver actually has to leave: the end of the last paid extension. */
  effectiveEndsAt: Date | null;
  /** Whether "Rate Parking" should be offered: review.service's rule, mirrored. */
  canReview: boolean;
};

function effectiveEnd(row: Pick<BookingRow, "endsAt" | "extensions">): Date | null {
  if (!row.endsAt) return null;

  return row.extensions
    .filter((extension) => extension.status === "CONFIRMED" && extension.endsAt)
    .reduce<Date>(
      (latest, extension) =>
        extension.endsAt! > latest ? extension.endsAt! : latest,
      row.endsAt
    );
}

function phaseOf(row: BookingRow, now: Date): BookingPhase {
  switch (row.status) {
    case "CANCELLED":
      return "CANCELLED";
    case "COMPLETED":
    case "NO_SHOW":
      return "COMPLETED";
    case "PENDING":
      return row.holdExpiresAt && row.holdExpiresAt <= now ? "EXPIRED" : "PENDING";
  }

  // CONFIRMED: where it sits against the clock.
  if (row.startsAt) {
    const end = effectiveEnd(row)!;
    if (now < row.startsAt) return "UPCOMING";
    return now < end ? "ACTIVE" : "COMPLETED";
  }

  const eventDate = row.parkingCapacity?.listing.eventDate;
  if (!eventDate || now < eventDate) return "UPCOMING";
  return now.getTime() < eventDate.getTime() + PASS_GRACE_MS ? "ACTIVE" : "COMPLETED";
}

/**
 * A paid stay at a host spot, over, and not yet rated -- the rule
 * review.service.create enforces. A CONFIRMED stay whose time has passed
 * counts: the review request sweeps it to COMPLETED before checking, so the
 * detail screen can offer the rating before any list has done the sweep.
 */
function canReview(row: BookingRow, phase: BookingPhase): boolean {
  return (
    row.listing !== null &&
    row.extendsBookingId === null &&
    row.review === null &&
    row.payment?.status === "CAPTURED" &&
    phase === "COMPLETED" &&
    (row.status === "COMPLETED" || row.status === "CONFIRMED")
  );
}

function present(row: BookingRow, now = new Date()): BookingView {
  const phase = phaseOf(row, now);
  return { ...row, phase, effectiveEndsAt: effectiveEnd(row), canReview: canReview(row, phase) };
}

function stripOwner(
  row: Prisma.BookingGetPayload<{ select: typeof bookingViewWithOwner }>
): BookingView {
  const { driverId: _driverId, ...view } = row;
  return present(view);
}

function graceCutoff(now = new Date()): Date {
  return new Date(now.getTime() - PASS_GRACE_MS);
}

/**
 * A confirmed stay that is running right now.
 *
 * A spot booking counts from its start until its last paid extension ends --
 * hence the second branch, for a stay whose own end has passed but whose
 * extension has not. An event booking counts from the event until the grace
 * period after it, the window in which a late arrival still needs the pass.
 */
function runningWhere(now: Date): Prisma.BookingWhereInput {
  return {
    status: "CONFIRMED",
    OR: [
      { startsAt: { lte: now }, endsAt: { gt: now } },
      {
        startsAt: { lte: now },
        extensions: { some: { status: "CONFIRMED", endsAt: { gt: now } } },
      },
      {
        parkingCapacity: {
          listing: { eventDate: { lte: now, gte: graceCutoff(now) } },
        },
      },
    ],
  };
}

/**
 * Not started yet: a hold still being paid for, or a confirmed booking whose
 * time is ahead. An undated event booking never starts, so it stays here.
 */
function upcomingWhere(now: Date): Prisma.BookingWhereInput {
  return {
    OR: [
      {
        status: "PENDING",
        OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }],
      },
      { status: "CONFIRMED", startsAt: { gt: now } },
      {
        status: "CONFIRMED",
        parkingCapacity: {
          listing: { OR: [{ eventDate: null }, { eventDate: { gt: now } }] },
        },
      },
    ],
  };
}

function scopeWhere(
  driverId: string,
  scope: BookingScope,
  now: Date
): Prisma.BookingWhereInput {
  // An extension is part of the booking it extends, never a row of its own
  // in the driver's lists.
  const base = { driverId, extendsBookingId: null };

  if (scope === "active") return { ...base, ...runningWhere(now) };
  if (scope === "upcoming") return { ...base, ...upcomingWhere(now) };

  // Everything else: finished, cancelled, or a hold that lapsed unpaid.
  return {
    ...base,
    NOT: [upcomingWhere(now), runningWhere(now)],
  };
}

/**
 * Records that stays which have ended are over.
 *
 * Written the moment someone looks rather than by a scheduler -- the same
 * trade expired holds make: the stored state is only read through these
 * lists, so bringing it up to date just before reading is enough. Taking a
 * finished stay out of the overlap guard is harmless, since its hours are in
 * the past.
 */
export async function completeEndedStays(driverId: string, now: Date): Promise<void> {
  await prisma.booking.updateMany({
    where: {
      driverId,
      status: "CONFIRMED",
      endsAt: { lte: now },
      // A stay still running on a paid extension is not over.
      NOT: { extensions: { some: { status: "CONFIRMED", endsAt: { gt: now } } } },
    },
    data: { status: "COMPLETED" },
  });
}

export async function listForDriver(
  driverId: string,
  options: { scope: BookingScope; cursor?: string; limit?: number }
): Promise<Page<BookingView>> {
  const limit = options.limit ?? DEFAULT_PAGE_SIZE;
  const now = new Date();

  await completeEndedStays(driverId, now);

  // One extra row tells us whether another page exists without a second count
  // query.
  const rows = await prisma.booking.findMany({
    where: scopeWhere(driverId, options.scope, now),
    select: bookingView,
    // Upcoming reads soonest first; the other two newest first.
    orderBy:
      options.scope === "upcoming"
        ? [{ startsAt: "asc" }, { createdAt: "asc" }, { id: "asc" }]
        : [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(options.cursor
      ? { cursor: { id: decodeCursor(options.cursor, 1)[0] }, skip: 1 }
      : {}),
  });

  const items = rows.slice(0, limit).map((row) => present(row, now));
  const last = items.at(-1);

  return {
    items,
    nextCursor: rows.length > limit && last ? encodeCursor([last.id]) : null,
  };
}

/**
 * The booking the driver is parked on right now, if any: what "Already
 * parked" opens straight into. Only confirmed stays -- an unpaid hold is not
 * a right to be in the space.
 */
export async function getActiveForDriver(
  driverId: string
): Promise<BookingView | null> {
  const now = new Date();
  const row = await prisma.booking.findFirst({
    where: { driverId, extendsBookingId: null, ...runningWhere(now) },
    select: bookingView,
    orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
  });

  return row ? present(row, now) : null;
}

/**
 * How to get into the space, released only once the driver has paid for it.
 *
 * Returned beside the booking rather than inside the shared projection, so
 * no list or unpaid hold can carry it by accident.
 */
export interface BookingAccess {
  accessInstructions: string | null;
}

export async function getForDriver(
  bookingId: string,
  driverId: string
): Promise<BookingView & { access: BookingAccess | null }> {
  const booking = await prisma.booking.findFirst({
    // driverId in the filter, not checked after the read: a "not yours" and a
    // "does not exist" must be indistinguishable, or booking ids become an
    // enumeration oracle.
    where: { id: bookingId, driverId },
    select: { ...bookingView, listing: { select: { ...bookingView.listing.select, accessInstructions: true } } },
  });

  if (!booking) {
    throw notFound("Booking not found");
  }

  const { listing, ...rest } = booking;
  const paid = booking.status === "CONFIRMED" || booking.status === "COMPLETED";

  let publicListing: BookingRow["listing"] = null;
  let access: BookingAccess | null = null;

  if (listing) {
    const { accessInstructions, ...shown } = listing;
    publicListing = shown;
    access = paid ? { accessInstructions } : null;
  }

  return { ...present({ ...rest, listing: publicListing }), access };
}

/**
 * Creates a booking, or returns the one an earlier identical attempt created.
 *
 * Three things are deliberately NOT taken from the request: the driver comes
 * from the JWT, the price from ParkingCapacity, and the QR token is generated
 * here. Accepting any of them from the caller lets someone book as another
 * user, at a price they choose, with a pass they minted.
 */
export async function create(
  input: CreateBookingInput,
  driverId: string
): Promise<{ booking: BookingView; replayed: boolean }> {
  try {
    const booking = await prisma.$transaction(async (tx) => {
      const existing = await tx.booking.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: bookingViewWithOwner,
      });

      if (existing) {
        // The key is unique across all users, so a guessed or copied key must
        // not hand back someone else's booking.
        if (existing.driverId !== driverId) {
          throw conflict("Idempotency key already used");
        }
        return { booking: stripOwner(existing), replayed: true };
      }

      const capacity = await tx.parkingCapacity.findUnique({
        where: { id: input.parkingCapacityId },
        include: { listing: true },
      });

      if (!capacity) {
        throw notFound("Parking capacity not found");
      }

      if (capacity.listing.listingType === "INDEPENDENT_SPOT") {
        // Host spots are priced per hour against a HostAvailability window,
        // not per slot. Booking one through this path would charge the wrong
        // amount, so it is refused rather than approximated.
        throw badRequest("Host spots are booked through the spot flow");
      }

      if (!BOOKABLE_LISTING_STATUSES.includes(capacity.listing.status)) {
        throw badRequest("This listing is not open for booking");
      }

      if (
        capacity.listing.eventDate &&
        capacity.listing.eventDate < graceCutoff()
      ) {
        throw badRequest("This event has already finished");
      }

      // The whole point of the bookedCount column. The condition lives in the
      // WHERE clause so the check and the increment are one statement: two
      // concurrent bookings for the last slot cannot both read "1 left" and
      // both write "2 booked". A read-then-write in application code oversells
      // under exactly the load an event sale produces.
      const claimed = await tx.$executeRaw`
        UPDATE "ParkingCapacity"
        SET "bookedCount" = "bookedCount" + ${input.quantity},
            "updatedAt" = NOW()
        WHERE "id" = ${input.parkingCapacityId}
          AND "bookedCount" + ${input.quantity} <= "totalCapacity"
      `;

      if (claimed === 0) {
        throw conflict("Not enough spots left");
      }

      const created = await tx.booking.create({
        data: {
          parkingCapacityId: input.parkingCapacityId,
          driverId,
          vehicleNumber: input.vehicleNumber,
          quantity: input.quantity,
          amount: capacity.price.mul(input.quantity),
          idempotencyKey: input.idempotencyKey,
          qrToken: generateQrToken(),
          createdBy: driverId,
          updatedBy: driverId,
        },
        select: bookingView,
      });

      return { booking: present(created), replayed: false };
    });

    return booking;
  } catch (error) {
    // Two identical requests can both pass the lookup above and race to the
    // insert. The loser's whole transaction rolls back -- its capacity
    // increment included -- so replaying the winner here is safe and does not
    // double-count a slot.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await prisma.booking.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: bookingViewWithOwner,
      });

      if (existing && existing.driverId === driverId) {
        return { booking: stripOwner(existing), replayed: true };
      }

      throw conflict("Idempotency key already used");
    }

    throw error;
  }
}

/**
 * Mints a short-lived pass for the driver's own booking.
 *
 * qrToken is read here and handed straight to the signer; it is not part of
 * any response projection, so the durable secret never leaves the server even
 * though the pass derived from it does.
 */
export async function issuePassForDriver(bookingId: string, driverId: string) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, driverId },
    select: {
      id: true,
      status: true,
      qrToken: true,
      vehicleType: true,
      startsAt: true,
      listing: { select: { name: true, venueName: true, eventDate: true } },
      parkingCapacity: {
        select: {
          gate: true,
          vehicleType: true,
          listing: {
            select: { name: true, venueName: true, eventDate: true },
          },
        },
      },
    },
  });

  if (!booking) {
    throw notFound("Booking not found");
  }

  if (booking.status !== "CONFIRMED") {
    throw badRequest("This booking has no pass yet");
  }

  // Exactly one side is populated -- the DB CHECK guarantees it -- so this
  // reads whichever is there rather than branching on a type flag. A host
  // spot has no gate: what a driver needs there is the access instructions,
  // which arrive with the booking rather than on the pass.
  const listing = booking.listing ?? booking.parkingCapacity?.listing;

  if (!listing) {
    throw notFound("Booking not found");
  }

  return {
    booking: {
      id: booking.id,
      gate: booking.parkingCapacity?.gate ?? null,
      vehicleType:
        booking.parkingCapacity?.vehicleType ?? booking.vehicleType ?? "CAR",
      eventName: listing.name,
      venueName: listing.venueName,
      eventDate: listing.eventDate ?? booking.startsAt,
    },
    pass: passService.issue(booking.id, booking.qrToken),
  };
}

// ------------------------------------------------------- host spot booking --

export interface CreateSpotBookingInput {
  listingId: string;
  vehicleType: string;
  vehicleNumber: string;
  startsAt: Date;
  endsAt: Date;
  idempotencyKey: string;
}

/** How long an unpaid booking keeps its hours. */
export const HOLD_MINUTES = 15;

/**
 * Whether an error is the booking overlap constraint firing.
 *
 * Matched on the message because Prisma does not model Postgres' 23P01: it
 * arrives as PrismaClientUnknownRequestError with both the code and the
 * constraint name only in the text. Both are checked so renaming either one
 * does not silently turn a 409 back into a 500.
 */
export function isOverlapViolation(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientUnknownRequestError) &&
    !(error instanceof Prisma.PrismaClientKnownRequestError)
  ) {
    return false;
  }

  const message = String(error.message);
  return message.includes("23P01") || message.includes("Booking_no_overlap");
}

/**
 * Releases holds nobody paid for.
 *
 * Run before each attempt on the same spot rather than on a schedule, the way
 * stale verification codes are purged on the next request for that address:
 * the only moment an expired hold matters is when somebody else wants those
 * hours, and that is exactly this moment.
 *
 * Cancelled rather than deleted, because the EXCLUDE constraint is scoped to
 * PENDING and CONFIRMED -- changing the status is what frees the time, and it
 * leaves the abandoned attempt visible instead of pretending it never
 * happened.
 */
export async function releaseExpiredHolds(
  tx: Prisma.TransactionClient,
  listingId: string
): Promise<void> {
  await tx.booking.updateMany({
    where: {
      listingId,
      status: "PENDING",
      holdExpiresAt: { lt: new Date() },
    },
    data: { status: "CANCELLED" },
  });
}

/**
 * Books a host's spot for a stretch of time.
 *
 * Separate from `create` because almost nothing about it is the same: the
 * price comes from an hourly rate rather than a slot price, the thing being
 * claimed is a range rather than a count, and what makes a claim valid is the
 * host's weekly schedule rather than an event date. Sharing one function
 * would mean two disjoint halves behind a flag.
 *
 * As with the event path, three things are never taken from the request: the
 * driver comes from the JWT, the price from SpotPricing, and the QR token is
 * generated here.
 */
export async function createSpotBooking(
  input: CreateSpotBookingInput,
  driverId: string
): Promise<{ booking: BookingView; replayed: boolean }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.booking.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: bookingViewWithOwner,
      });

      if (existing) {
        if (existing.driverId !== driverId) {
          throw conflict("Idempotency key already used");
        }
        return { booking: stripOwner(existing), replayed: true };
      }

      // Serialises this with blocks (and, later, monthly reservations) on the
      // same listing -- see lib/listing-lock.
      await lockListing(tx, input.listingId);

      // The same three gates the search and the public read apply, so a spot
      // that has stopped being bookable cannot still be booked by anyone
      // holding a link to it.
      const spot = await tx.listing.findFirst({
        where: {
          id: input.listingId,
          listingType: "INDEPENDENT_SPOT",
          status: { in: BOOKABLE_LISTING_STATUSES },
          hostProfile: {
            verificationStatus: "ACTIVE",
            payoutKycStatus: "ACTIVATED",
          },
        },
        select: {
          id: true,
          bookingsPausedAt: true,
          pricing: { select: { vehicleType: true, pricePerHour: true, pricePerDay: true } },
          availability: {
            where: { isActive: true },
            select: { dayOfWeek: true, startMinute: true, endMinute: true },
          },
        },
      });

      if (!spot) {
        throw notFound("Spot not found");
      }

      if (spot.bookingsPausedAt) {
        throw conflict("This space isn't taking new bookings right now.");
      }

      const rate = spot.pricing.find(
        (row) => row.vehicleType === input.vehicleType
      );

      if (!rate) {
        throw badRequest("This spot does not take that vehicle type");
      }

      // Every venue-local day the stay touches has to be covered by a window
      // of its own. An overnight stay is two questions; asked as one range it
      // could never match, because a window ends at midnight.
      if (!windowsCover(spot.availability, input.startsAt, input.endsAt)) {
        throw badRequest("The spot is not open for all of those hours");
      }

      await releaseExpiredHolds(tx, input.listingId);
      await assertNotBlocked(tx, input.listingId, input.startsAt, input.endsAt);
      await assertNoMonthlyConflict(tx, input.listingId, input.startsAt, input.endsAt);

      const minutes = Math.round(
        (input.endsAt.getTime() - input.startsAt.getTime()) / 60_000
      );

      // The same price the checkout quoted: the cheaper of hourly and daily,
      // by the minute. Plus GatePass's fee and its GST, fixed now so a later
      // change to the fee never reprices a booking already made.
      const { amount } = stayPrice(rate, minutes);
      const { platformFee, taxAmount } = driverFees();

      const created = await tx.booking.create({
        data: {
          listingId: input.listingId,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          holdExpiresAt: new Date(Date.now() + HOLD_MINUTES * 60_000),
          driverId,
          vehicleNumber: input.vehicleNumber,
          vehicleType: input.vehicleType,
          quantity: 1,
          amount,
          platformFee,
          taxAmount,
          idempotencyKey: input.idempotencyKey,
          qrToken: generateQrToken(),
          createdBy: driverId,
          updatedBy: driverId,
        },
        select: bookingView,
      });

      audit("SPOT_BOOKING_HELD", { userId: driverId, bookingId: created.id, listingId: input.listingId });
      return { booking: present(created), replayed: false };
    });
  } catch (error) {
    if (isOverlapViolation(error)) {
      // Someone else's booking covers part of those hours. The database
      // refused it, which is the only place that check can be trusted: two
      // concurrent requests both read "free" before either writes.
      throw conflict("Those hours have just been taken. Try a different time.");
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await prisma.booking.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: bookingViewWithOwner,
      });

      if (existing && existing.driverId === driverId) {
        return { booking: stripOwner(existing), replayed: true };
      }

      throw conflict("Idempotency key already used");
    }

    throw error;
  }
}

/**
 * Hours already taken on a spot, so the app can grey them out instead of
 * letting a driver pick a range the database will refuse.
 *
 * Only the ranges, never who booked them: when a driveway is busy is a fact
 * about the spot, who is in it is not.
 */
export async function bookedRanges(
  listingId: string,
  from: Date,
  to: Date
): Promise<{ startsAt: Date; endsAt: Date }[]> {
  const rows = await prisma.booking.findMany({
    where: {
      listingId,
      status: { in: ["PENDING", "CONFIRMED"] },
      startsAt: { lt: to },
      endsAt: { gt: from },
    },
    select: { startsAt: true, endsAt: true },
    orderBy: { startsAt: "asc" },
  });

  return rows.filter(
    (row): row is { startsAt: Date; endsAt: Date } =>
      row.startsAt !== null && row.endsAt !== null
  );
}
