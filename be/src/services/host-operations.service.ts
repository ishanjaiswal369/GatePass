import { Prisma } from "@prisma/client";
import { pricing } from "../config/pricing.js";
import { conflict, notFound } from "../lib/errors.js";
import { bookingRef, clock, day } from "../lib/format.js";
import { lockListing } from "../lib/listing-lock.js";
import { occurrencesBetween } from "../lib/monthly.js";
import { termsTouching } from "../lib/monthly-guard.js";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/security-log.js";
import { addDays, startOfVenueDay, startOfVenueMonth, venueDate, weekdayOf } from "../lib/venue-calendar.js";
import { VENUE_TIME_ZONE } from "../lib/venue-time.js";
import * as payoutService from "./host-payout.service.js";
import { occurrenceViews, paidTermsOn, presentTerm, shareStartingBetween, termMoney, termPhase, termsFor } from "./host-monthly.js";
import * as reviewService from "./review.service.js";

/**
 * The host's side of running a space (Phase 5): the Host tab's summary, one
 * space's dashboard, its bookings, its calendar and blocks, pausing, and the
 * earnings ledger.
 *
 * Every query here has the caller's hostProfileId in its WHERE, so another
 * host's space, booking or block answers exactly like one that doesn't exist.
 *
 * Money: a host earns the parking they *keep* -- the amount minus anything
 * refunded, never below zero -- less GatePass's commission. The driver's
 * platform fee and its GST are GatePass's and never come out of it.
 */

const HOST_BOOKINGS_CAP = 50;

type PayoutState = "PENDING" | "AVAILABLE" | "PAID_OUT" | "NONE";

const hostBookingSelect = {
  id: true,
  status: true,
  startsAt: true,
  endsAt: true,
  amount: true,
  createdAt: true,
  cancelledAt: true,
  vehicleNumber: true,
  vehicleType: true,
  driverId: true,
  listing: { select: { id: true, name: true } },
  driver: { select: { firstName: true, lastName: true } },
  payment: { select: { status: true, updatedAt: true } },
  refund: { select: { amount: true, policy: true } },
  problem: { select: { status: true, category: true } },
  extensions: {
    where: { status: "CONFIRMED", payment: { status: "CAPTURED" } },
    select: { endsAt: true, amount: true },
  },
  settlementItems: { select: { settlement: { select: { status: true } } } },
} satisfies Prisma.BookingSelect;

type HostBookingRow = Prisma.BookingGetPayload<{ select: typeof hostBookingSelect }>;

/** "Rahul S." -- enough to greet someone at the gate. */
function driverName(driver: { firstName: string | null; lastName: string | null }): string {
  const first = driver.firstName?.trim();
  if (!first) return "A driver";
  const initial = driver.lastName?.trim().charAt(0);
  return `${first}${initial ? ` ${initial.toUpperCase()}.` : ""}`;
}

function effectiveEnd(row: HostBookingRow): Date | null {
  return row.extensions.reduce<Date | null>(
    (latest, ext) => (ext.endsAt && (!latest || ext.endsAt > latest) ? ext.endsAt : latest),
    row.endsAt
  );
}

/** The parking the host keeps, and their share of it after commission. */
function earningOf(row: HostBookingRow): { gross: Prisma.Decimal; earning: Prisma.Decimal } {
  const parking = row.extensions.reduce((sum, ext) => sum.add(ext.amount), row.amount);
  const refunded = row.refund?.amount ?? new Prisma.Decimal(0);
  const kept = Prisma.Decimal.max(parking.sub(refunded), 0);
  return { gross: parking, earning: kept.mul(1 - pricing.hostCommissionRate).toDecimalPlaces(2) };
}

function payoutState(row: HostBookingRow, now: Date): PayoutState {
  const { earning } = earningOf(row);
  if (earning.lte(0)) return "NONE";
  if (row.settlementItems.some((item) => item.settlement.status === "PAID")) return "PAID_OUT";
  // A cancellation settles what the host keeps at once; a stay, when it ends.
  if (row.status === "CANCELLED") return "AVAILABLE";
  const end = effectiveEnd(row);
  return end && end <= now ? "AVAILABLE" : "PENDING";
}

function phaseOf(row: HostBookingRow, now: Date): "UPCOMING" | "ACTIVE" | "COMPLETED" | "CANCELLED" {
  if (row.status === "CANCELLED") return "CANCELLED";
  if (row.status === "COMPLETED" || row.status === "NO_SHOW") return "COMPLETED";
  const end = effectiveEnd(row);
  if (row.startsAt && now < row.startsAt) return "UPCOMING";
  return end && now < end ? "ACTIVE" : "COMPLETED";
}

/** A driver's saved label for the plate they booked with ("Maruti Swift"), if they gave one. */
async function vehicleLabels(rows: { driverId: string; vehicleNumber: string }[]): Promise<Map<string, string>> {
  if (rows.length === 0) return new Map();
  const vehicles = await prisma.vehicle.findMany({
    where: { OR: rows.map((row) => ({ userId: row.driverId, vehicleNumber: row.vehicleNumber })) },
    select: { userId: true, vehicleNumber: true, label: true },
  });
  return new Map(
    vehicles.filter((v) => v.label).map((v) => [`${v.userId}:${v.vehicleNumber}`, v.label!])
  );
}

function present(row: HostBookingRow, labels: Map<string, string>, now: Date) {
  const { gross, earning } = earningOf(row);
  return {
    id: row.id,
    ref: bookingRef(row.id),
    listing: row.listing,
    phase: phaseOf(row, now),
    startsAt: row.startsAt,
    endsAt: effectiveEnd(row),
    driver: driverName(row.driver),
    vehicle: {
      number: row.vehicleNumber,
      type: row.vehicleType,
      label: labels.get(`${row.driverId}:${row.vehicleNumber}`) ?? null,
    },
    /** Parking the driver paid for, extensions included. */
    amount: gross.toString(),
    earning: earning.toString(),
    payout: payoutState(row, now),
    /** Booked in the last day: the "New booking" badge. */
    isNew: now.getTime() - row.createdAt.getTime() < 24 * 60 * 60_000,
    cancelledAt: row.cancelledAt,
    refundPolicy: row.refund?.policy ?? null,
    problem: row.problem,
    /** Set on a monthly reservation's card (host-monthly); null for a stay. */
    monthly: null as ReturnType<typeof presentTerm>["monthly"] | null,
  };
}

export type HostBookingView = ReturnType<typeof present>;

/** Paid bookings on the host's spaces. Never unpaid holds: those aren't bookings yet. */
function paidOn(hostProfileId: string, listingId?: string): Prisma.BookingWhereInput {
  return {
    extendsBookingId: null,
    listing: { hostProfileId, ...(listingId ? { id: listingId } : {}) },
    payment: { status: "CAPTURED" },
  };
}

async function ownedListing(listingId: string, hostProfileId: string) {
  const listing = await prisma.listing.findFirst({
    where: { id: listingId, hostProfileId, listingType: "INDEPENDENT_SPOT" },
    select: {
      id: true,
      name: true,
      status: true,
      addressLine: true,
      city: true,
      bookingsPausedAt: true,
      availability: { where: { isActive: true }, select: { dayOfWeek: true, startMinute: true, endMinute: true } },
      _count: { select: { photos: true } },
    },
  });
  if (!listing) throw notFound("Spot not found");
  return listing;
}

// ---------- Bookings ----------

export type HostScope = "upcoming" | "active" | "completed" | "cancelled";

export async function listBookings(hostProfileId: string, options: { listingId?: string; scope: HostScope }) {
  if (options.listingId) await ownedListing(options.listingId, hostProfileId);
  const now = new Date();
  const base = paidOn(hostProfileId, options.listingId);

  const where: Prisma.BookingWhereInput =
    options.scope === "cancelled"
      ? { ...base, status: "CANCELLED" }
      : options.scope === "upcoming"
        ? { ...base, status: "CONFIRMED", startsAt: { gt: now } }
        : options.scope === "active"
          ? { ...base, status: "CONFIRMED", startsAt: { lte: now } }
          : { ...base, status: { in: ["CONFIRMED", "COMPLETED", "NO_SHOW"] }, startsAt: { lte: now } };

  const rows = await prisma.booking.findMany({
    where,
    select: hostBookingSelect,
    orderBy: options.scope === "upcoming" ? [{ startsAt: "asc" }] : [{ startsAt: "desc" }],
    take: HOST_BOOKINGS_CAP,
  });

  // "active" and "completed" split a CONFIRMED stay by its effective end,
  // which SQL alone can't see (extensions), so the last step is here.
  const filtered = rows.filter((row) => {
    const phase = phaseOf(row, now);
    if (options.scope === "active") return phase === "ACTIVE";
    if (options.scope === "completed") return phase === "COMPLETED";
    return true;
  });

  // Monthly terms in the same tabs, by where the term stands.
  const terms = (await termsFor(paidTermsOn(hostProfileId, options.listingId))).filter((t) => {
    const phase = termPhase(t, now);
    return options.scope === "upcoming" ? phase === "UPCOMING" : options.scope === "active" ? phase === "ACTIVE" : options.scope === "completed" ? phase === "COMPLETED" : phase === "CANCELLED";
  });

  const labels = await vehicleLabels([...filtered, ...terms]);
  const items = [...filtered.map((row) => present(row, labels, now)), ...terms.map((t) => presentTerm(t, labels, now))];
  items.sort((a, b) =>
    options.scope === "upcoming"
      ? (a.startsAt?.getTime() ?? 0) - (b.startsAt?.getTime() ?? 0)
      : (b.startsAt?.getTime() ?? 0) - (a.startsAt?.getTime() ?? 0)
  );
  return { items };
}

// ---------- Space dashboard ----------

export async function overview(listingId: string, hostProfileId: string) {
  const listing = await ownedListing(listingId, hostProfileId);
  const now = new Date();
  const today = venueDate(now);
  const dayStart = startOfVenueDay(today);
  const dayEnd = startOfVenueDay(addDays(today, 1));
  const monthStart = startOfVenueMonth(now);

  const [todays, upcoming, month, ratings, terms] = await Promise.all([
    prisma.booking.findMany({
      where: {
        ...paidOn(hostProfileId, listingId),
        status: { in: ["CONFIRMED", "COMPLETED"] },
        startsAt: { lt: dayEnd },
        endsAt: { gt: dayStart },
      },
      select: hostBookingSelect,
      orderBy: { startsAt: "asc" },
    }),
    prisma.booking.findMany({
      where: { ...paidOn(hostProfileId, listingId), status: "CONFIRMED", startsAt: { gt: now } },
      select: { startsAt: true },
      orderBy: { startsAt: "asc" },
    }),
    prisma.booking.findMany({
      where: { ...paidOn(hostProfileId, listingId), startsAt: { gte: monthStart, lte: now } },
      select: hostBookingSelect,
    }),
    reviewService.ratingsFor([listingId]),
    termsFor({ ...paidTermsOn(hostProfileId, listingId), status: { in: ["CONFIRMED", "COMPLETED", "CANCELLED"] } }),
  ]);

  const labels = await vehicleLabels([...todays, ...terms]);
  const todayViews = [...todays.map((row) => present(row, labels, now)), ...occurrenceViews(terms, dayStart, dayEnd, labels, now)].sort(
    (a, b) => (a.startsAt?.getTime() ?? 0) - (b.startsAt?.getTime() ?? 0)
  );
  const monthNet = month
    .reduce((sum, row) => sum.add(earningOf(row).earning), new Prisma.Decimal(0))
    .add(terms.reduce((sum, t) => sum.add(shareStartingBetween(t, monthStart, now).net), new Prisma.Decimal(0)));
  const upcomingTerms = terms.filter((t) => termPhase(t, now) === "UPCOMING");
  const nextStarts = [upcoming[0]?.startsAt, ...upcomingTerms.map((t) => presentTerm(t, labels, now).startsAt)]
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime());
  const rated = ratings.get(listingId);

  return {
    listing: {
      id: listing.id,
      name: listing.name,
      status: listing.status,
      address: [listing.addressLine, listing.city].filter(Boolean).join(", "),
      paused: listing.bookingsPausedAt !== null,
      photoCount: listing._count.photos,
    },
    today: {
      count: todayViews.length,
      parkedNow: todayViews.filter((b) => b.phase === "ACTIVE").length,
      bookings: todayViews,
    },
    upcoming: { count: upcoming.length + upcomingTerms.length, nextStartsAt: nextStarts[0] ?? null },
    month: { net: monthNet.toString(), commissionRate: pricing.hostCommissionRate },
    rating: { average: rated?.rating ?? null, count: rated?.reviewCount ?? 0 },
  };
}

export async function setPaused(listingId: string, hostProfileId: string, userId: string, paused: boolean) {
  await ownedListing(listingId, hostProfileId);
  await prisma.listing.update({
    where: { id: listingId },
    data: { bookingsPausedAt: paused ? new Date() : null, updatedBy: userId },
  });
  audit(paused ? "LISTING_PAUSED" : "LISTING_RESUMED", { userId, listingId });
  return { paused };
}

// ---------- Host tab ----------

export async function summary(hostProfileId: string) {
  const now = new Date();
  const monthStart = startOfVenueMonth(now);
  const today = venueDate(now);
  const dayStart = startOfVenueDay(today);
  const dayEnd = startOfVenueDay(addDays(today, 1));

  const [month, todays, listings, terms] = await Promise.all([
    prisma.booking.findMany({
      where: { ...paidOn(hostProfileId), startsAt: { gte: monthStart, lte: now } },
      select: hostBookingSelect,
    }),
    prisma.booking.findMany({
      where: { ...paidOn(hostProfileId), status: { in: ["CONFIRMED", "COMPLETED"] }, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
      select: hostBookingSelect,
      orderBy: { startsAt: "asc" },
    }),
    prisma.listing.findMany({ where: { hostProfileId, listingType: "INDEPENDENT_SPOT" }, select: { id: true } }),
    termsFor({ ...paidTermsOn(hostProfileId), status: { in: ["CONFIRMED", "COMPLETED", "CANCELLED"] } }),
  ]);
  const { available } = await ledgerTotals(hostProfileId, now);
  const ratings = await reviewService.ratingsFor(listings.map((l) => l.id));

  const net = month
    .reduce((sum, row) => sum.add(earningOf(row).earning), new Prisma.Decimal(0))
    .add(terms.reduce((sum, t) => sum.add(shareStartingBetween(t, monthStart, now).net), new Prisma.Decimal(0)));
  const labels = await vehicleLabels([...todays, ...terms]);
  const termsThisMonth = terms.filter((t) => t.status !== "CANCELLED" && shareStartingBetween(t, monthStart, now).gross.gt(0)).length;

  return {
    month: { net: net.toString(), bookings: month.filter((row) => row.status !== "CANCELLED").length + termsThisMonth },
    available: available.toString(),
    today: [...todays.map((row) => present(row, labels, now)), ...occurrenceViews(terms, dayStart, dayEnd, labels, now)].sort(
      (a, b) => (a.startsAt?.getTime() ?? 0) - (b.startsAt?.getTime() ?? 0)
    ),
    /** Per space, for the list below the card. */
    ratings: Object.fromEntries([...ratings.entries()].map(([id, r]) => [id, r])),
  };
}

// ---------- Earnings ----------

async function ledgerRows(hostProfileId: string) {
  return prisma.booking.findMany({
    where: { ...paidOn(hostProfileId), status: { in: ["CONFIRMED", "COMPLETED", "NO_SHOW", "CANCELLED"] } },
    select: hostBookingSelect,
    orderBy: { startsAt: "desc" },
  });
}

async function ledgerTotals(hostProfileId: string, now: Date) {
  const [rows, terms] = await Promise.all([
    ledgerRows(hostProfileId),
    termsFor({ ...paidTermsOn(hostProfileId), status: { in: ["CONFIRMED", "COMPLETED", "CANCELLED"] } }),
  ]);
  let available = new Prisma.Decimal(0);
  let pending = new Prisma.Decimal(0);
  for (const row of rows) {
    const state = payoutState(row, now);
    const { earning } = earningOf(row);
    if (state === "AVAILABLE") available = available.add(earning);
    if (state === "PENDING") pending = pending.add(earning);
  }
  // A term releases its share month by month (host-monthly.termMoney).
  for (const t of terms) {
    const money = termMoney(t, now);
    available = available.add(money.available);
    pending = pending.add(money.pending);
  }
  return { rows, terms, available, pending };
}

export async function earnings(hostProfileId: string) {
  const now = new Date();
  const monthStart = startOfVenueMonth(now);
  const { rows, terms, available, pending } = await ledgerTotals(hostProfileId, now);

  const [payouts, account] = await Promise.all([
    prisma.settlement.findMany({
      where: { hostProfileId, status: "PAID" },
      select: { id: true, netPayable: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    }),
    payoutService.getStatus(hostProfileId),
  ]);

  let gross = new Prisma.Decimal(0);
  let net = new Prisma.Decimal(0);
  for (const row of rows) {
    if (!row.startsAt || row.startsAt < monthStart || row.startsAt > now) continue;
    const kept = Prisma.Decimal.max(earningOf(row).gross.sub(row.refund?.amount ?? 0), 0);
    gross = gross.add(kept);
    net = net.add(earningOf(row).earning);
  }
  for (const t of terms) {
    const share = shareStartingBetween(t, monthStart, now);
    gross = gross.add(share.gross);
    net = net.add(share.net);
  }

  const labels = await vehicleLabels([...rows.slice(0, 30), ...terms]);
  const transactions = [
    ...terms.map((t) => {
      const view = presentTerm(t, labels, now);
      return {
        kind: "BOOKING" as const,
        id: t.id,
        title: `Monthly ${view.ref}`,
        sub: `${view.driver} · ${t.months} ${t.months === 1 ? "month" : "months"} from ${day(startOfVenueDay(t.startDate))}`,
        amount: view.earning,
        state: view.payout,
        at: view.startsAt as Date | null,
      };
    }),
    ...rows.slice(0, 30).map((row) => {
      const view = present(row, labels, now);
      return {
        kind: "BOOKING" as const,
        id: row.id,
        title: `Booking ${view.ref}`,
        sub: `${view.driver} · ${row.startsAt ? day(row.startsAt) : ""}`,
        amount: view.earning,
        state: view.payout,
        at: row.startsAt,
      };
    }),
    ...payouts.map((p) => ({
      kind: "PAYOUT" as const,
      id: p.id,
      title: "Payout to your bank",
      sub: day(p.updatedAt),
      amount: p.netPayable.neg().toString(),
      state: "PAID_OUT" as PayoutState,
      at: p.updatedAt,
    })),
  ].sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));

  return {
    available: available.toString(),
    pending: pending.toString(),
    paidOut: payouts.reduce((sum, p) => sum.add(p.netPayable), new Prisma.Decimal(0)).toString(),
    month: {
      label: now.toLocaleDateString("en-IN", { month: "long", timeZone: VENUE_TIME_ZONE }),
      gross: gross.toString(),
      commission: gross.sub(net).toString(),
      net: net.toString(),
    },
    commissionRate: pricing.hostCommissionRate,
    transactions,
    payoutAccount: account,
  };
}

// ---------- Calendar and blocks ----------

const MAX_CALENDAR_DAYS = 14;

export async function calendar(listingId: string, hostProfileId: string, from: string, days: number) {
  const listing = await ownedListing(listingId, hostProfileId);
  const span = Math.min(days, MAX_CALENDAR_DAYS);
  const start = startOfVenueDay(from);
  const end = startOfVenueDay(addDays(from, span));
  const now = new Date();

  const [bookings, blocks, terms] = await Promise.all([
    prisma.booking.findMany({
      where: {
        listingId,
        listing: { hostProfileId },
        extendsBookingId: null,
        startsAt: { lt: end },
        endsAt: { gt: start },
        OR: [
          { status: { in: ["CONFIRMED", "COMPLETED"] }, payment: { status: "CAPTURED" } },
          { status: "PENDING", holdExpiresAt: { gt: now } },
        ],
      },
      select: { ...hostBookingSelect, holdExpiresAt: true },
      orderBy: { startsAt: "asc" },
    }),
    prisma.listingBlock.findMany({
      where: { listingId, listing: { hostProfileId }, startsAt: { lt: end }, endsAt: { gt: start } },
      select: { id: true, startsAt: true, endsAt: true, reason: true },
      orderBy: { startsAt: "asc" },
    }),
    // Paid terms, and holds still being paid for (shown as held, like bookings).
    termsFor({
      listingId,
      listing: { hostProfileId },
      startDate: { lt: addDays(from, span) },
      endDate: { gt: from },
      OR: [{ status: "CONFIRMED", payment: { status: "CAPTURED" } }, { status: "PENDING", holdExpiresAt: { gt: now } }],
    }),
  ]);
  const labels = await vehicleLabels([...bookings, ...terms]);

  return {
    listing: { id: listing.id, name: listing.name, paused: listing.bookingsPausedAt !== null },
    weeklyHours: listing.availability,
    days: Array.from({ length: span }, (_, i) => {
      const date = addDays(from, i);
      const dayStart = startOfVenueDay(date);
      const dayEnd = startOfVenueDay(addDays(date, 1));
      const overlaps = (s: Date | null, e: Date | null) => !!s && !!e && s < dayEnd && e > dayStart;
      return {
        date,
        weekday: weekdayOf(date),
        windows: listing.availability
          .filter((w) => w.dayOfWeek === weekdayOf(date))
          .map((w) => ({ startMinute: w.startMinute, endMinute: w.endMinute })),
        bookings: [
          ...bookings
            .filter((b) => overlaps(b.startsAt, effectiveEnd(b)))
            .map((b) => ({ ...present(b, labels, now), held: b.status === "PENDING" })),
          ...terms.flatMap((t) =>
            occurrenceViews([t], dayStart, dayEnd, labels, now).map((v) => ({ ...v, held: t.status === "PENDING" }))
          ),
        ].sort((a, b) => (a.startsAt?.getTime() ?? 0) - (b.startsAt?.getTime() ?? 0)),
        blocks: blocks.filter((b) => overlaps(b.startsAt, b.endsAt)),
      };
    }),
  };
}

type BlockInput =
  | { kind: "range"; startsAt: Date; endsAt: Date; reason?: string }
  | { kind: "day"; date: string; freeOnly: boolean; reason?: string };

/** [start, end) minus the given ranges, as the pieces left over. */
function subtract(start: Date, end: Date, taken: { start: Date; end: Date }[]): { start: Date; end: Date }[] {
  let pieces = [{ start, end }];
  for (const t of taken) {
    pieces = pieces.flatMap((p) => {
      if (t.end <= p.start || t.start >= p.end) return [p];
      const out = [];
      if (t.start > p.start) out.push({ start: p.start, end: t.start });
      if (t.end < p.end) out.push({ start: t.end, end: p.end });
      return out;
    });
  }
  return pieces.filter((p) => p.end > p.start);
}

export async function createBlocks(listingId: string, hostProfileId: string, userId: string, input: BlockInput) {
  const listing = await ownedListing(listingId, hostProfileId);

  return prisma.$transaction(async (tx) => {
    await lockListing(tx, listingId);
    const now = new Date();

    const range =
      input.kind === "range"
        ? { start: input.startsAt, end: input.endsAt }
        : { start: startOfVenueDay(input.date), end: startOfVenueDay(addDays(input.date, 1)) };

    const [taking, blocked, terms] = await Promise.all([
      tx.booking.findMany({
        where: {
          listingId,
          startsAt: { lt: range.end },
          endsAt: { gt: range.start },
          OR: [{ status: "CONFIRMED" }, { status: "PENDING", holdExpiresAt: { gt: now } }],
        },
        select: { id: true, startsAt: true, endsAt: true, status: true, driver: { select: { firstName: true, lastName: true } } },
        orderBy: { startsAt: "asc" },
      }),
      tx.listingBlock.findMany({
        where: { listingId, startsAt: { lt: range.end }, endsAt: { gt: range.start } },
        select: { startsAt: true, endsAt: true },
      }),
      termsTouching(tx, [listingId], range.start, range.end),
    ]);
    // Monthly reservations' hours inside the range, like bookings.
    const termHours = terms.flatMap((term) =>
      occurrencesBetween(term, range.start, range.end).map((o) => ({ ...o, driver: term.driver }))
    );

    let pieces: { start: Date; end: Date }[];
    if (input.kind === "day" && input.freeOnly) {
      // The day's open hours, less what is booked or already blocked.
      const open = listing.availability
        .filter((w) => w.dayOfWeek === weekdayOf(input.date))
        .map((w) => ({
          start: new Date(range.start.getTime() + w.startMinute * 60_000),
          end: new Date(range.start.getTime() + w.endMinute * 60_000),
        }));
      const taken = [
        ...taking.map((b) => ({ start: b.startsAt!, end: b.endsAt! })),
        ...termHours.map((o) => ({ start: o.start, end: o.end })),
        ...blocked.map((b) => ({ start: b.startsAt, end: b.endsAt })),
      ];
      pieces = open.flatMap((w) => subtract(w.start, w.end, taken));
    } else {
      if (taking.length > 0) {
        const first = taking[0]!;
        throw Object.assign(
          conflict(
            `${day(first.startsAt!)} has a ${first.status === "PENDING" ? "booking being paid for" : "confirmed booking"}: ${driverName(first.driver)}, ${clock(first.startsAt!)} – ${clock(first.endsAt!)}. Blocking won't cancel it; block only the free hours instead.`
          ),
          {
            extra: {
              booking: {
                ref: bookingRef(first.id),
                driver: driverName(first.driver),
                startsAt: first.startsAt,
                endsAt: first.endsAt,
              },
            },
          }
        );
      }
      if (termHours.length > 0) {
        const first = termHours[0]!;
        throw Object.assign(
          conflict(
            `${day(first.start)} has a monthly reservation: ${driverName(first.driver)}, ${clock(first.start)} – ${clock(first.end)}. Blocking won't cancel it; block only the free hours instead.`
          ),
          { extra: { booking: { monthly: true, driver: driverName(first.driver), startsAt: first.start, endsAt: first.end } } }
        );
      }
      if (blocked.length > 0) throw conflict("Part of that time is already blocked.");
      pieces = [range];
    }

    if (pieces.length === 0) throw conflict("There are no free hours left to block on that day.");

    const created = [];
    for (const piece of pieces) {
      created.push(
        await tx.listingBlock.create({
          data: { listingId, startsAt: piece.start, endsAt: piece.end, reason: input.reason ?? null, createdBy: userId },
          select: { id: true, startsAt: true, endsAt: true, reason: true },
        })
      );
    }
    audit("BLOCK_CREATED", { userId, listingId, blocks: created.map((b) => b.id) });
    return { blocks: created };
  });
}

export async function removeBlock(listingId: string, blockId: string, hostProfileId: string, userId: string) {
  const { count } = await prisma.listingBlock.deleteMany({
    where: { id: blockId, listingId, listing: { hostProfileId } },
  });
  if (count === 0) throw notFound("Block not found");
  audit("BLOCK_REMOVED", { userId, listingId, blockId });
  return { removed: true };
}
