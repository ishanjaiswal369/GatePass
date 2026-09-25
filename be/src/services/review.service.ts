import { Prisma } from "@prisma/client";
import { BOOKABLE_SPOT } from "../lib/bookable-spot.js";
import { publicName } from "../lib/display-name.js";
import { conflict, notFound } from "../lib/errors.js";
import { DEFAULT_PAGE_SIZE, type Page, decodeCursor, encodeCursor } from "../lib/pagination.js";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/security-log.js";
import { completeEndedStays } from "./booking.service.js";

/**
 * Drivers rating spots (Phase 3).
 *
 * One-way and one per booking: a driver rates a spot after a stay they paid
 * for, and that is the whole conversation -- no host replies, no edits. What
 * other drivers see is computed from these rows on every read, so a review
 * taken down (`hiddenAt`) leaves every average at once.
 */

export interface ReviewInput {
  rating: number;
  easyToFind?: number;
  asDescribed?: number;
  access?: number;
  comment?: string;
}

/** Only reviews still on show count, anywhere. */
const VISIBLE = { hiddenAt: null } satisfies Prisma.ReviewWhereInput;

/**
 * Rates the spot of one of the caller's bookings.
 *
 * The booking is read with the caller's id in the WHERE, so someone else's
 * booking and a made-up id both answer 404. The spot and the driver written
 * onto the review come from that row, never from the request.
 *
 * A stay that has ended but not yet been swept to COMPLETED is swept first --
 * the same write the booking lists make -- so a driver can rate straight from
 * the "your parking has ended" moment without opening the Past tab.
 *
 * The unique `bookingId` is the real one-per-booking rule: the check below
 * only produces a friendlier message, and two submits that both get past it
 * still produce one row and a 409.
 */
export async function create(bookingId: string, driverId: string, input: ReviewInput) {
  await completeEndedStays(driverId, new Date());

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, driverId },
    select: {
      status: true,
      listingId: true,
      extendsBookingId: true,
      payment: { select: { status: true } },
      review: { select: { id: true } },
    },
  });

  if (!booking) throw notFound("Booking not found");

  const refusal = whyNotReviewable(booking);
  if (refusal) throw conflict(refusal);

  try {
    const review = await prisma.review.create({
      data: {
        bookingId,
        listingId: booking.listingId!,
        driverId,
        rating: input.rating,
        easyToFind: input.easyToFind,
        asDescribed: input.asDescribed,
        access: input.access,
        comment: input.comment,
      },
      select: ownReview,
    });
    audit("REVIEW_CREATED", { userId: driverId, bookingId, reviewId: review.id, rating: review.rating });
    return review;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw conflict("You've already reviewed this parking.");
    }
    throw error;
  }
}

const ownReview = {
  id: true,
  rating: true,
  easyToFind: true,
  asDescribed: true,
  access: true,
  comment: true,
  createdAt: true,
} satisfies Prisma.ReviewSelect;

/**
 * Why this booking can't be reviewed, in words for the driver; null when it
 * can. The same rule as `canReview` on a booking view, which the app uses to
 * decide whether to offer "Rate Parking" at all.
 */
function whyNotReviewable(booking: {
  status: string;
  listingId: string | null;
  extendsBookingId: string | null;
  payment: { status: string } | null;
  review: { id: string } | null;
}): string | null {
  if (booking.review) return "You've already reviewed this parking.";
  // Event parking is rated nowhere, and extra time is part of the stay it
  // extends -- that stay gets the one review.
  if (!booking.listingId || booking.extendsBookingId) return "This booking can't be reviewed.";
  if (booking.status === "CANCELLED") return "A cancelled booking can't be reviewed.";
  if (booking.status === "NO_SHOW") return "This booking was marked as a no-show, so it can't be reviewed.";
  if (booking.status !== "COMPLETED") return "You can review this parking once your stay has ended.";
  if (booking.payment?.status !== "CAPTURED") return "Only a paid stay can be reviewed.";
  return null;
}

export interface RatingSummary {
  /** One decimal; null when nobody has rated the spot. */
  average: number | null;
  count: number;
  /** How many gave each star count, 5 down to 1. Sums to `count`. */
  breakdown: { stars: number; count: number }[];
  /** Each sub-rating's average over the reviews that answered it. */
  subRatings: {
    easyToFind: SubRating;
    asDescribed: SubRating;
    access: SubRating;
  };
}

interface SubRating {
  average: number | null;
  count: number;
}

const oneDecimal = (value: number | null | undefined) =>
  value === null || value === undefined ? null : Math.round(value * 10) / 10;

/** The full picture for one spot: the detail screen and the all-reviews page. */
export async function summaryFor(listingId: string): Promise<RatingSummary> {
  const where = { listingId, ...VISIBLE };

  const [byStars, subs] = await Promise.all([
    prisma.review.groupBy({ by: ["rating"], where, _count: { _all: true } }),
    prisma.review.aggregate({
      where,
      _avg: { easyToFind: true, asDescribed: true, access: true },
      _count: { easyToFind: true, asDescribed: true, access: true },
    }),
  ]);

  const count = byStars.reduce((sum, row) => sum + row._count._all, 0);
  const total = byStars.reduce((sum, row) => sum + row.rating * row._count._all, 0);

  return {
    average: count > 0 ? oneDecimal(total / count) : null,
    count,
    breakdown: [5, 4, 3, 2, 1].map((stars) => ({
      stars,
      count: byStars.find((row) => row.rating === stars)?._count._all ?? 0,
    })),
    subRatings: {
      easyToFind: { average: oneDecimal(subs._avg.easyToFind), count: subs._count.easyToFind },
      asDescribed: { average: oneDecimal(subs._avg.asDescribed), count: subs._count.asDescribed },
      access: { average: oneDecimal(subs._avg.access), count: subs._count.access },
    },
  };
}

/**
 * Average and count for many spots in one query: what a search card or a saved
 * spot shows. Spots nobody has rated are absent from the map.
 */
export async function ratingsFor(
  listingIds: string[]
): Promise<Map<string, { rating: number; reviewCount: number }>> {
  if (listingIds.length === 0) return new Map();

  const rows = await prisma.review.groupBy({
    by: ["listingId"],
    where: { listingId: { in: listingIds }, ...VISIBLE },
    _avg: { rating: true },
    _count: { _all: true },
  });

  return new Map(
    rows.map((row) => [row.listingId, { rating: oneDecimal(row._avg.rating)!, reviewCount: row._count._all }])
  );
}

/**
 * A review as other drivers see it: who (by first name and initial), the
 * stars, the words and when. Not the booking, the vehicle or the account.
 */
const publicReview = {
  id: true,
  rating: true,
  easyToFind: true,
  asDescribed: true,
  access: true,
  comment: true,
  createdAt: true,
  driver: { select: { firstName: true, lastName: true } },
} satisfies Prisma.ReviewSelect;

type PublicReviewRow = Prisma.ReviewGetPayload<{ select: typeof publicReview }>;

export type PublicReview = Omit<PublicReviewRow, "driver"> & { reviewer: string };

function present({ driver, ...rest }: PublicReviewRow): PublicReview {
  return { ...rest, reviewer: publicName(driver.firstName, driver.lastName, "GatePass driver") };
}

/** The newest few, for the spot detail screen. */
export async function recentFor(listingId: string, take = 3): Promise<PublicReview[]> {
  const rows = await prisma.review.findMany({
    where: { listingId, ...VISIBLE },
    select: publicReview,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
  });
  return rows.map(present);
}

/**
 * Every review of a spot, newest first, with the summary on the first page.
 *
 * Behind the same gate as the spot itself: a spot a driver cannot open has no
 * reviews to read either, and an unknown id and a hidden spot look alike.
 */
export async function listForSpot(
  listingId: string,
  options: { cursor?: string; limit?: number }
): Promise<Page<PublicReview> & { summary: RatingSummary | null }> {
  const spot = await prisma.listing.findFirst({ where: { id: listingId, ...BOOKABLE_SPOT }, select: { id: true } });
  if (!spot) throw notFound("Spot not found");

  const limit = options.limit ?? DEFAULT_PAGE_SIZE;
  const cursorId = options.cursor ? decodeCursor(options.cursor, 1)[0] : null;

  // The cursor row has to be one of this spot's visible reviews, or Prisma's
  // cursor would silently start somewhere else -- or from another spot's row.
  if (cursorId) {
    const anchor = await prisma.review.findFirst({ where: { id: cursorId, listingId, ...VISIBLE }, select: { id: true } });
    if (!anchor) throw notFound("Review not found");
  }

  const [rows, summary] = await Promise.all([
    prisma.review.findMany({
      where: { listingId, ...VISIBLE },
      select: publicReview,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    }),
    // Only the first page carries the summary; later pages are more of the
    // same list.
    cursorId ? Promise.resolve(null) : summaryFor(listingId),
  ]);

  const items = rows.slice(0, limit).map(present);
  const last = items.at(-1);

  return { items, nextCursor: rows.length > limit && last ? encodeCursor([last.id]) : null, summary };
}
