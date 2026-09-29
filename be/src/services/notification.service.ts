import type { Prisma } from "@prisma/client";
import {
  NOTIFICATION_KINDS,
  type NotificationKind,
} from "../constants/enums/index.js";
import { DEFAULT_SETTINGS } from "../constants/user-settings.js";
import { bookingRef, clock, day, rupees } from "../lib/format.js";
import { DEFAULT_PAGE_SIZE, type Page, decodeCursor, encodeCursor } from "../lib/pagination.js";
import { prisma } from "../lib/prisma.js";
import { schedulePushFlush } from "./push-dispatch.service.js";

/**
 * The inbox (Phase 4).
 *
 * `notify` is the only writer. It applies the recipient's settings, and
 * composes nothing itself -- callers pass a title and body built from stored
 * facts, never from text another user typed.
 *
 * Two ways entries appear:
 * - at the event: a cancellation, a refund decision, a report filed or
 *   resolved, a listing reviewed;
 * - from state, when the inbox is read (`syncFromState`): reminders that are
 *   due, and confirmations -- a booking becomes CONFIRMED through the payment
 *   integration, which this API does not own, so the inbox notices the state
 *   rather than waiting for a call that may never be wired to it. Each such
 *   entry carries a dedupe key, so reading the inbox twice writes it once.
 *   The same function also runs every minute for users with something due
 *   (notification-jobs), so a reminder lands on time with the app closed.
 *
 * Every new entry is also pushed to the recipient's devices (push-dispatch),
 * unless they switched push off. The email setting is stored only.
 */

export const REMINDER_LEAD_MS = 30 * 60_000;
/** How far back state-derived entries reach, so a first inbox open isn't a flood of history. */
const LOOKBACK_MS = 7 * 24 * 60 * 60_000;
/** "The day after a completed booking." */
export const REVIEW_AFTER_MS = 12 * 60 * 60_000;
/**
 * Lapsed holds are reported only this recently: an abandoned checkout from
 * last week isn't worth an inbox line, and one from minutes ago is.
 */
export const HOLD_EXPIRY_LOOKBACK_MS = 60 * 60_000;
/**
 * A payment started just before the hold ran out can still land (see
 * payment-confirmation, LATE_WINDOW_MS). Wait this long past both the hold
 * and the gateway order before calling it expired.
 */
const HOLD_EXPIRY_GRACE_MS = 2 * 60_000;

export interface NotificationInput {
  title: string;
  body: string;
  bookingId?: string;
  listingId?: string;
  /** Present on anything that could be written twice. */
  dedupeKey?: string;
  /** When it happened, if not now -- a confirmation noticed later keeps its own time. */
  at?: Date;
}

/**
 * Adds entries to inboxes, skipping recipients who switched that kind off
 * (their UserSettings, or its default) and any dedupe key already written. Pass `tx` to write inside the caller's
 * transaction, so an entry can't describe a change that rolled back.
 */
export async function notify(
  userId: string,
  kind: NotificationKind,
  input: NotificationInput,
  tx: Prisma.TransactionClient = prisma
): Promise<void> {
  const switchKey = NOTIFICATION_KINDS[kind];
  if (switchKey) {
    const settings = await tx.userSettings.findUnique({ where: { userId } });
    const on: boolean = settings ? settings[switchKey] : DEFAULT_SETTINGS[switchKey];
    if (!on) return;
  }

  const { count } = await tx.notification.createMany({
    data: [
      {
        userId,
        kind,
        title: input.title,
        body: input.body,
        bookingId: input.bookingId ?? null,
        listingId: input.listingId ?? null,
        dedupeKey: input.dedupeKey ?? null,
        ...(input.at ? { createdAt: input.at } : {}),
      },
    ],
    skipDuplicates: true,
  });

  // Delivered from the table, not from here: see push-dispatch.
  if (count > 0) schedulePushFlush();
}

/** When a paid stay actually ends: its own end, or its last confirmed extension's. */
function effectiveEnd(row: { endsAt: Date | null; extensions: { endsAt: Date | null }[] }): Date | null {
  return row.extensions.reduce<Date | null>(
    (latest, ext) => (ext.endsAt && (!latest || ext.endsAt > latest) ? ext.endsAt : latest),
    row.endsAt
  );
}

/**
 * Writes whatever the stored state says is due for this user and not yet in
 * their inbox. Every entry is keyed, so this is safe to run on every read.
 */
export async function syncFromState(userId: string, now = new Date()): Promise<void> {
  const since = new Date(now.getTime() - LOOKBACK_MS);
  const soon = new Date(now.getTime() + REMINDER_LEAD_MS);

  const [driving, hosting] = await Promise.all([
    prisma.booking.findMany({
      where: {
        driverId: userId,
        extendsBookingId: null,
        listingId: { not: null },
        OR: [
          // Confirmations and "starts/ends soon".
          { status: { in: ["CONFIRMED", "COMPLETED"] }, updatedAt: { gte: since } },
          { status: "CONFIRMED", startsAt: { lte: soon } },
          // Rate-your-parking.
          { status: "COMPLETED", endsAt: { gte: since, lte: new Date(now.getTime() - REVIEW_AFTER_MS) } },
        ],
      },
      select: {
        id: true,
        status: true,
        startsAt: true,
        endsAt: true,
        updatedAt: true,
        listing: { select: { id: true, name: true, entryPoint: true } },
        payment: { select: { status: true, amount: true, updatedAt: true } },
        review: { select: { id: true } },
        extensions: { where: { status: "CONFIRMED" }, select: { endsAt: true } },
        refund: { select: { amount: true, status: true, processedAt: true } },
      },
    }),
    prisma.booking.findMany({
      where: {
        status: { in: ["CONFIRMED", "COMPLETED"] },
        extendsBookingId: null,
        updatedAt: { gte: since },
        listing: { hostProfile: { userId } },
        payment: { status: "CAPTURED" },
      },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        amount: true,
        payment: { select: { updatedAt: true } },
        listing: { select: { id: true, name: true } },
        driver: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  for (const b of driving) {
    const name = b.listing?.name ?? "Your parking";
    const paid = b.payment?.status === "CAPTURED";

    if (paid && (b.status === "CONFIRMED" || b.status === "COMPLETED") && b.startsAt && b.endsAt) {
      await notify(userId, "BOOKING_CONFIRMED", {
        title: `Booking confirmed · ${bookingRef(b.id)}`,
        body: `${day(b.startsAt)}, ${clock(b.startsAt)} – ${clock(b.endsAt)}. Paid ${rupees(b.payment!.amount)}.`,
        bookingId: b.id,
        listingId: b.listing?.id,
        dedupeKey: `confirmed:${b.id}`,
        at: b.payment!.updatedAt,
      });
    }

    if (paid && b.status === "CONFIRMED" && b.startsAt && b.startsAt > now && b.startsAt <= soon) {
      const minutes = Math.max(1, Math.round((b.startsAt.getTime() - now.getTime()) / 60_000));
      await notify(userId, "STARTING_SOON", {
        title: `Your parking starts in ${minutes} minutes`,
        body: `${name}${b.listing?.entryPoint ? `. ${b.listing.entryPoint}` : ""}.`,
        bookingId: b.id,
        listingId: b.listing?.id,
        dedupeKey: `start:${b.id}`,
      });
    }

    const end = effectiveEnd(b);
    if (paid && b.status === "CONFIRMED" && end && b.startsAt && b.startsAt <= now && end > now && end <= soon) {
      const minutes = Math.max(1, Math.round((end.getTime() - now.getTime()) / 60_000));
      await notify(userId, "ENDING_SOON", {
        title: `Your parking ends in ${minutes} minutes`,
        body: `${name} ends at ${clock(end)}. Extend if you need longer.`,
        bookingId: b.id,
        listingId: b.listing?.id,
        // Keyed to the end time: extra time bought earns a fresh reminder.
        dedupeKey: `end:${b.id}:${end.toISOString()}`,
      });
    }

    // "The day after": the query also returns stays finished minutes ago (for
    // their confirmation), so the timing is checked here, not only there.
    if (paid && b.status === "COMPLETED" && !b.review && b.startsAt && end && end.getTime() <= now.getTime() - REVIEW_AFTER_MS) {
      await notify(userId, "REVIEW_REMINDER", {
        title: `How was ${name}?`,
        body: `Rate your parking on ${day(b.startsAt)} to help other drivers.`,
        bookingId: b.id,
        listingId: b.listing?.id,
        dedupeKey: `review:${b.id}`,
      });
    }
  }

  for (const b of hosting) {
    if (!b.startsAt || !b.endsAt) continue;
    const driver = b.driver.firstName
      ? `${b.driver.firstName}${b.driver.lastName ? ` ${b.driver.lastName.charAt(0).toUpperCase()}.` : ""}`
      : "A driver";
    await notify(userId, "HOST_NEW_BOOKING", {
      title: `New booking at ${b.listing?.name ?? "your space"}`,
      body: `${driver} · ${day(b.startsAt)}, ${clock(b.startsAt)} – ${clock(b.endsAt)}`,
      bookingId: b.id,
      listingId: b.listing?.id,
      dedupeKey: `hostnew:${b.id}`,
      at: b.payment?.updatedAt,
    });
  }

  // "Payout sent" (HOST_PAYOUT) is written when the gateway's settlement
  // webhook arrives -- see host-payout-ledger.service.

  // Refunds that have landed. Written as REFUND_STARTED at the decision;
  // this is the second half, noticed from the refund's own state.
  const landed = await prisma.refund.findMany({
    where: { status: "REFUNDED", processedAt: { gte: since }, booking: { driverId: userId } },
    select: { amount: true, processedAt: true, bookingId: true, booking: { select: { listing: { select: { name: true } } } } },
  });
  for (const r of landed) {
    await notify(userId, "REFUND_SENT", {
      title: "Refund processed",
      body: `${rupees(r.amount)} for ${r.booking.listing?.name ?? "your booking"} is back with your bank.`,
      bookingId: r.bookingId,
      dedupeKey: `refunded:${r.bookingId}`,
      at: r.processedAt ?? undefined,
    });
  }

  // Extra time bought and paid for. An extension is its own booking row, so
  // the driving query above (originals only) doesn't see it.
  const extensions = await prisma.booking.findMany({
    where: {
      driverId: userId,
      extendsBookingId: { not: null },
      status: "CONFIRMED",
      updatedAt: { gte: since },
      payment: { status: "CAPTURED" },
    },
    select: {
      id: true,
      endsAt: true,
      extendsBookingId: true,
      payment: { select: { amount: true, updatedAt: true } },
      extendsBooking: { select: { listing: { select: { id: true, name: true } } } },
    },
  });
  for (const ext of extensions) {
    if (!ext.endsAt || !ext.extendsBookingId || !ext.payment) continue;
    await notify(userId, "BOOKING_EXTENDED", {
      title: `Extra time confirmed · ${bookingRef(ext.extendsBookingId)}`,
      body: `${ext.extendsBooking?.listing?.name ?? "Your parking"} now until ${clock(ext.endsAt)}, ${day(ext.endsAt)}. Paid ${rupees(ext.payment.amount)}.`,
      // The stay it extends: that's the screen a tap should open.
      bookingId: ext.extendsBookingId,
      listingId: ext.extendsBooking?.listing?.id,
      dedupeKey: `extended:${ext.id}`,
      at: ext.payment.updatedAt,
    });
  }

  // Holds that ran out unpaid. Status alone can't say so -- a lapsed hold
  // stays PENDING until something releases it, then reads CANCELLED like a
  // driver's own cancellation -- so: hold time past, no cancellation of the
  // driver's, and no captured payment.
  const graceEdge = new Date(now.getTime() - HOLD_EXPIRY_GRACE_MS);
  const lapsed = await prisma.booking.findMany({
    where: {
      driverId: userId,
      extendsBookingId: null,
      status: { in: ["PENDING", "CANCELLED"] },
      cancelledAt: null,
      holdExpiresAt: { gte: new Date(now.getTime() - HOLD_EXPIRY_LOOKBACK_MS), lte: graceEdge },
      OR: [{ payment: null }, { payment: { status: { not: "CAPTURED" } } }],
    },
    select: {
      id: true,
      holdExpiresAt: true,
      listing: { select: { id: true, name: true } },
      payment: { select: { gatewayExpiresAt: true } },
    },
  });
  for (const b of lapsed) {
    // The gateway order may outlive the hold by a little; a payment can
    // still land until it closes.
    const orderClosesAt = b.payment?.gatewayExpiresAt;
    if (orderClosesAt && orderClosesAt > graceEdge) continue;
    await notify(userId, "HOLD_EXPIRED", {
      title: `Your hold on ${b.listing?.name ?? "the parking"} expired`,
      body: "It wasn't paid for in time, so the spot was released. Book again if it's still free.",
      bookingId: b.id,
      listingId: b.listing?.id,
      dedupeKey: `holdexp:${b.id}`,
      // When it really ended: the later of the hold and the order. Stamped
      // with the hold alone, one whose order ran on longer would already be
      // too old to push by the time it was written.
      at: orderClosesAt && b.holdExpiresAt && orderClosesAt > b.holdExpiresAt ? orderClosesAt : b.holdExpiresAt ?? undefined,
    });
  }
}

const inboxSelect = {
  id: true,
  kind: true,
  title: true,
  body: true,
  bookingId: true,
  listingId: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

export async function list(
  userId: string,
  options: { cursor?: string; limit?: number }
): Promise<Page<Prisma.NotificationGetPayload<{ select: typeof inboxSelect }>> & { unread: number }> {
  if (!options.cursor) await syncFromState(userId);

  const limit = options.limit ?? DEFAULT_PAGE_SIZE;
  const cursorId = options.cursor ? decodeCursor(options.cursor, 1)[0] : null;
  if (cursorId) {
    // The anchor must be the caller's own, or Prisma would page from someone else's row.
    const own = await prisma.notification.findFirst({ where: { id: cursorId, userId }, select: { id: true } });
    if (!own) return { items: [], nextCursor: null, unread: await unreadCount(userId, false) };
  }

  const rows = await prisma.notification.findMany({
    where: { userId },
    select: inboxSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
  });

  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? encodeCursor([last.id]) : null,
    unread: await unreadCount(userId, false),
  };
}

export async function unreadCount(userId: string, sync = true): Promise<number> {
  if (sync) await syncFromState(userId);
  return prisma.notification.count({ where: { userId, readAt: null } });
}

/** Marks the caller's own entries read -- `userId` in the WHERE, so other ids are simply not touched. */
export async function markRead(userId: string, ids?: string[]): Promise<{ updated: number }> {
  const { count } = await prisma.notification.updateMany({
    where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  return { updated: count };
}
