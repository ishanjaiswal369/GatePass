import type { Prisma } from "@prisma/client";
import {
  NOTIFICATION_KINDS,
  type NotificationKind,
  type NotificationPreferenceKey,
} from "../constants/enums/index.js";
import { bookingRef, clock, day, rupees } from "../lib/format.js";
import { DEFAULT_PAGE_SIZE, type Page, decodeCursor, encodeCursor } from "../lib/pagination.js";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/security-log.js";

/**
 * The inbox (Phase 4).
 *
 * `notify` is the only writer. It applies the recipient's preferences, and
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
 *   Same lazy pattern as expired holds and finished stays: no scheduler.
 *
 * Only the inbox is delivered. Push and email preferences are stored for when
 * those channels exist (spec, Phase 4, "not built").
 */

type Preferences = Record<NotificationPreferenceKey, boolean>;

export const DEFAULT_PREFERENCES: Preferences = {
  startingSoon: true,
  endingSoon: true,
  refunds: true,
  reviewReminders: true,
  hostNewBookings: true,
  hostPayouts: true,
  hostListing: true,
  push: true,
  email: true,
  offers: false,
};

const REMINDER_LEAD_MS = 30 * 60_000;
/** How far back state-derived entries reach, so a first inbox open isn't a flood of history. */
const LOOKBACK_MS = 7 * 24 * 60 * 60_000;
/** "The day after a completed booking." */
const REVIEW_AFTER_MS = 12 * 60 * 60_000;

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

export async function getPreferences(userId: string): Promise<Preferences> {
  const row = await prisma.notificationPreference.findUnique({ where: { userId } });
  if (!row) return { ...DEFAULT_PREFERENCES };
  const { id: _id, userId: _u, createdAt: _c, updatedAt: _up, ...prefs } = row;
  return prefs;
}

export async function updatePreferences(userId: string, patch: Partial<Preferences>): Promise<Preferences> {
  await prisma.notificationPreference.upsert({
    where: { userId },
    update: patch,
    create: { userId, ...patch },
  });
  audit("NOTIFICATION_PREFS_CHANGED", { userId, changed: Object.keys(patch) });
  return getPreferences(userId);
}

/**
 * Adds entries to inboxes, skipping recipients who switched that kind off
 * and any dedupe key already written. Pass `tx` to write inside the caller's
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
    const prefs = await tx.notificationPreference.findUnique({ where: { userId }, select: { [switchKey]: true } });
    const on = prefs ? (prefs as Record<string, boolean>)[switchKey] : DEFAULT_PREFERENCES[switchKey];
    if (!on) return;
  }

  await tx.notification.createMany({
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
