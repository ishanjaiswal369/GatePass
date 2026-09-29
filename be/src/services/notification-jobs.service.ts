import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { completeEndedStays } from "./booking.service.js";
import { HOLD_EXPIRY_LOOKBACK_MS, REMINDER_LEAD_MS, REVIEW_AFTER_MS, syncFromState } from "./notification.service.js";
import { clearExpiredPushTokens, flushPushes } from "./push-dispatch.service.js";

/**
 * The every-minute job behind push notifications.
 *
 * The inbox fills itself lazily (syncFromState runs when a user reads it),
 * which is fine for an inbox and useless for a push: "your parking starts in
 * 30 minutes" has to arrive while the app is closed. So once a minute this
 * finds the users with something due and runs the same syncFromState for
 * them -- dedupe keys make that safe however often it runs -- then sends
 * whatever is waiting in the push outbox.
 *
 * In-process on purpose: one API process, no queue to run. A second process
 * would also run it harmlessly (keys dedupe inbox rows, the outbox claim is
 * atomic), or can switch it off with NOTIFICATION_JOBS_ENABLED=false.
 */

const TICK_MS = 60_000;
/** Recent enough changes to look at: a few ticks, so a slow or missed one is covered. */
const RECENT_MS = 10 * 60_000;
/** Stays that may have ended long enough ago for a review reminder, but not so long it's stale. */
const REVIEW_WINDOW_MS = 24 * 60 * 60_000;

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startNotificationJobs(): void {
  if (!env.NOTIFICATION_JOBS_ENABLED || timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  // First run shortly after boot, not a full minute later.
  setTimeout(() => void tick(), 5_000).unref();
}

export function stopNotificationJobs(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

async function tick(): Promise<void> {
  // A slow tick (a backlog, a slow FCM) must not overlap the next one.
  if (running) return;
  running = true;
  try {
    await sweepDueReminders();
    await clearExpiredPushTokens();
    const pushed = await flushPushes();
    if (pushed.sent || pushed.failed || pushed.dropped) {
      console.log(
        `[push] sent ${pushed.sent}, skipped ${pushed.skipped}, failed ${pushed.failed}, dead tokens ${pushed.dropped}`
      );
    }
  } catch (error) {
    console.error("[notification-jobs] tick failed", error);
  } finally {
    running = false;
  }
}

/**
 * Brings the inbox up to date for every user who may have something due now:
 * a stay starting or ending soon, a booking or refund that just changed, a
 * finished stay due its review reminder. Returns how many users it looked at.
 */
export async function sweepDueReminders(now = new Date()): Promise<number> {
  const soon = new Date(now.getTime() + REMINDER_LEAD_MS);
  const recent = new Date(now.getTime() - RECENT_MS);
  const reviewDue = new Date(now.getTime() - REVIEW_AFTER_MS);
  const reviewFrom = new Date(reviewDue.getTime() - REVIEW_WINDOW_MS);
  const holdFrom = new Date(now.getTime() - HOLD_EXPIRY_LOOKBACK_MS);

  const [bookings, refunds] = await Promise.all([
    prisma.booking.findMany({
      where: {
        listingId: { not: null },
        OR: [
          // Starting soon, running (ending soon), or ended but not yet marked done.
          { extendsBookingId: null, status: "CONFIRMED", startsAt: { lte: soon }, endsAt: { gte: reviewFrom } },
          // Just confirmed: the driver's confirmation, the host's new booking,
          // and extra time bought on a stay (an extension is its own row).
          { status: { in: ["CONFIRMED", "COMPLETED"] }, updatedAt: { gte: recent } },
          // Review reminders fall due twelve hours after the end.
          { extendsBookingId: null, status: "COMPLETED", endsAt: { gte: reviewFrom, lte: reviewDue } },
          // A hold that lapsed unpaid in the last hour (syncFromState decides
          // whether it has really ended).
          {
            extendsBookingId: null,
            status: { in: ["PENDING", "CANCELLED"] },
            cancelledAt: null,
            holdExpiresAt: { gte: holdFrom, lte: now },
          },
        ],
      },
      select: {
        driverId: true,
        status: true,
        endsAt: true,
        extendsBookingId: true,
        listing: { select: { hostProfile: { select: { userId: true } } } },
      },
    }),
    prisma.refund.findMany({
      where: { status: "REFUNDED", processedAt: { gte: recent } },
      select: { booking: { select: { driverId: true } } },
    }),
  ]);

  const users = new Set<string>();
  // Drivers whose ended stays should be marked COMPLETED first: review
  // reminders are only written for completed stays, and completion is
  // otherwise recorded only when the driver opens their bookings.
  const toComplete = new Set<string>();
  for (const b of bookings) {
    users.add(b.driverId);
    const host = b.listing?.hostProfile?.userId;
    if (host) users.add(host);
    if (b.status === "CONFIRMED" && b.endsAt && b.endsAt <= now && !b.extendsBookingId) toComplete.add(b.driverId);
  }
  for (const r of refunds) users.add(r.booking.driverId);

  for (const driverId of toComplete) {
    await completeEndedStays(driverId, now);
  }
  for (const userId of users) {
    try {
      await syncFromState(userId, now);
    } catch (error) {
      // One user's bad row mustn't stop everyone else's reminders.
      console.error(`[notification-jobs] sync for ${userId} failed`, error);
    }
  }
  return users.size;
}
