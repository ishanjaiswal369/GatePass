import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { conflict, badRequest, notFound } from "../lib/errors.js";
import {
  DEFAULT_PAGE_SIZE,
  type Page,
  decodeCursor,
  encodeCursor,
} from "../lib/pagination.js";
import { prisma } from "../lib/prisma.js";
import { daySegments } from "../lib/venue-time.js";
import * as passService from "./pass.service.js";

export interface CreateBookingInput {
  parkingCapacityId: string;
  vehicleNumber: string;
  quantity: number;
  idempotencyKey: string;
}

export type BookingScope = "upcoming" | "past";

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
function generateQrToken(): string {
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
 */
const bookingView = {
  id: true,
  quantity: true,
  amount: true,
  status: true,
  vehicleNumber: true,
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
      eventDate: true,
      listingType: true,
      status: true,
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
} satisfies Prisma.BookingSelect;

type BookingView = Prisma.BookingGetPayload<{ select: typeof bookingView }>;

/** The same projection plus the owner, for checks that must not be returned. */
const bookingViewWithOwner = { ...bookingView, driverId: true } satisfies Prisma.BookingSelect;

function stripOwner(
  row: Prisma.BookingGetPayload<{ select: typeof bookingViewWithOwner }>
): BookingView {
  const { driverId: _driverId, ...view } = row;
  return view;
}

function graceCutoff(): Date {
  return new Date(Date.now() - PASS_GRACE_MS);
}

/**
 * Bookings that still matter to the driver: not cancelled, and either undated
 * or recent enough that the pass is still worth showing.
 */
function upcomingWhere(driverId: string): Prisma.BookingWhereInput {
  return {
    driverId,
    status: { in: ["PENDING", "CONFIRMED"] },
    parkingCapacity: {
      listing: {
        OR: [{ eventDate: null }, { eventDate: { gte: graceCutoff() } }],
      },
    },
  };
}

function pastWhere(driverId: string): Prisma.BookingWhereInput {
  return {
    driverId,
    NOT: upcomingWhere(driverId),
  };
}

export async function listForDriver(
  driverId: string,
  options: { scope: BookingScope; cursor?: string; limit?: number }
): Promise<Page<BookingView>> {
  const limit = options.limit ?? DEFAULT_PAGE_SIZE;

  const where =
    options.scope === "upcoming" ? upcomingWhere(driverId) : pastWhere(driverId);

  // One extra row tells us whether another page exists without a second count
  // query.
  const rows = await prisma.booking.findMany({
    where,
    select: bookingView,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(options.cursor
      ? { cursor: { id: decodeCursor(options.cursor, 1)[0] }, skip: 1 }
      : {}),
  });

  const items = rows.slice(0, limit);
  const last = items.at(-1);

  return {
    items,
    nextCursor: rows.length > limit && last ? encodeCursor([last.id]) : null,
  };
}

/**
 * The pass the home screen shows above discovery: the next booking the driver
 * can actually walk in with. PENDING is excluded -- an unpaid hold is not a
 * pass, and showing one would put a QR on screen that the gate rejects.
 */
export async function getActiveForDriver(
  driverId: string
): Promise<BookingView | null> {
  return prisma.booking.findFirst({
    where: {
      driverId,
      status: "CONFIRMED",
      parkingCapacity: {
        listing: {
          OR: [{ eventDate: null }, { eventDate: { gte: graceCutoff() } }],
        },
      },
    },
    select: bookingView,
    orderBy: [
      { parkingCapacity: { listing: { eventDate: "asc" } } },
      { createdAt: "asc" },
    ],
  });
}

export async function getForDriver(
  bookingId: string,
  driverId: string
): Promise<BookingView> {
  const booking = await prisma.booking.findFirst({
    // driverId in the filter, not checked after the read: a "not yours" and a
    // "does not exist" must be indistinguishable, or booking ids become an
    // enumeration oracle.
    where: { id: bookingId, driverId },
    select: bookingView,
  });

  if (!booking) {
    throw notFound("Booking not found");
  }

  return booking;
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

      return { booking: created, replayed: false };
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
const HOLD_MINUTES = 15;

/**
 * Whether an error is the booking overlap constraint firing.
 *
 * Matched on the message because Prisma does not model Postgres' 23P01: it
 * arrives as PrismaClientUnknownRequestError with both the code and the
 * constraint name only in the text. Both are checked so renaming either one
 * does not silently turn a 409 back into a 500.
 */
function isOverlapViolation(error: unknown): boolean {
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
async function releaseExpiredHolds(
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
          pricing: { select: { vehicleType: true, pricePerHour: true } },
          availability: {
            where: { isActive: true },
            select: { dayOfWeek: true, startMinute: true, endMinute: true },
          },
        },
      });

      if (!spot) {
        throw notFound("Spot not found");
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
      for (const segment of daySegments(input.startsAt, input.endsAt)) {
        const covered = spot.availability.some(
          (window) =>
            window.dayOfWeek === segment.dayOfWeek &&
            window.startMinute <= segment.startMinute &&
            window.endMinute >= segment.endMinute
        );

        if (!covered) {
          throw badRequest("The spot is not open for all of those hours");
        }
      }

      await releaseExpiredHolds(tx, input.listingId);

      const minutes = Math.round(
        (input.endsAt.getTime() - input.startsAt.getTime()) / 60_000
      );

      // Billed by the minute against the hourly rate, rounded to the rupee.
      // Rounding up a part hour would make a 61-minute stay cost two hours,
      // which reads as a penalty for being five minutes late back.
      const amount = rate.pricePerHour.mul(minutes).div(60).toDecimalPlaces(2);

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
          idempotencyKey: input.idempotencyKey,
          qrToken: generateQrToken(),
          createdBy: driverId,
          updatedBy: driverId,
        },
        select: bookingView,
      });

      return { booking: created, replayed: false };
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
