import { getPushProvider } from "../integrations/push/index.js";
import { app } from "../lib/app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Push delivery: the inbox is the outbox.
 *
 * `notify` writes an inbox row and asks for a flush; the flush claims rows not
 * yet pushed (setting `pushedAt` first, so two flushes never send one row
 * twice) and sends each to every signed-in device of its recipient. A row
 * written in a transaction that rolls back never becomes visible here, so it
 * is never pushed -- which is why `notify` doesn't send directly.
 *
 * Only rows created in the last FRESH_MS are pushed. Reminders and
 * confirmations derived from state are backdated to when they happened, and a
 * week-old confirmation surfacing on a phone is noise, not news.
 */

const FRESH_MS = 15 * 60_000;
const BATCH = 200;
/** Long enough that a caller's transaction has committed before we look. */
const KICK_DELAY_MS = 1500;

interface Claimed {
  id: string;
  userId: string;
  kind: string;
  title: string;
  body: string;
  bookingId: string | null;
  listingId: string | null;
}

export interface FlushResult {
  sent: number;
  /** Claimed but not sent: push switched off, or no device with a token. */
  skipped: number;
  /** Tokens FCM called dead, now forgotten. */
  dropped: number;
  failed: number;
}

let kick: NodeJS.Timeout | null = null;

/** Called by `notify` after it writes: pushes promptly instead of at the next minute. */
export function schedulePushFlush(): void {
  if (kick) return;
  kick = setTimeout(() => {
    kick = null;
    flushPushes().catch((error) => app.log.error({ err: error }, "push: flush failed"));
  }, KICK_DELAY_MS);
  kick.unref();
}

export async function flushPushes(now = new Date()): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, skipped: 0, dropped: 0, failed: 0 };
  const since = new Date(now.getTime() - FRESH_MS);

  // Claim in one statement. SKIP LOCKED lets a concurrent flush take the next
  // rows instead of waiting on these.
  const claimed = await prisma.$queryRaw<Claimed[]>`
    UPDATE "Notification" SET "pushedAt" = ${now}
    WHERE "id" IN (
      SELECT "id" FROM "Notification"
      WHERE "pushedAt" IS NULL AND "createdAt" >= ${since}
      ORDER BY "createdAt"
      LIMIT ${BATCH}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "userId", "kind", "title", "body", "bookingId", "listingId"`;
  if (claimed.length === 0) return result;

  const userIds = [...new Set(claimed.map((row) => row.userId))];
  const [prefs, sessions] = await Promise.all([
    prisma.userSettings.findMany({ where: { userId: { in: userIds } }, select: { userId: true, push: true } }),
    prisma.userSession.findMany({
      where: { userId: { in: userIds }, fcmToken: { not: null }, expiresAt: { gt: now } },
      select: { userId: true, fcmToken: true },
    }),
  ]);
  // No settings row means the defaults, where push is on.
  const pushOff = new Set(prefs.filter((p) => !p.push).map((p) => p.userId));
  const tokensByUser = new Map<string, string[]>();
  for (const s of sessions) {
    if (!s.fcmToken) continue;
    tokensByUser.set(s.userId, [...(tokensByUser.get(s.userId) ?? []), s.fcmToken]);
  }

  const provider = getPushProvider();
  const dead = new Set<string>();

  for (const row of claimed) {
    const tokens = pushOff.has(row.userId) ? [] : (tokensByUser.get(row.userId) ?? []).filter((t) => !dead.has(t));
    if (tokens.length === 0) {
      result.skipped++;
      continue;
    }

    const data: Record<string, string> = { notificationId: row.id, kind: row.kind };
    if (row.bookingId) data.bookingId = row.bookingId;
    if (row.listingId) data.listingId = row.listingId;

    for (const token of tokens) {
      try {
        const sent = await provider.send({ token, title: row.title, body: row.body, data });
        if (sent.ok) result.sent++;
        else dead.add(token);
      } catch (error) {
        // Not retried later: a reminder that arrives after its moment is
        // worse than one that doesn't. The inbox still has it.
        result.failed++;
        app.log.error({ err: error, kind: row.kind, userId: row.userId }, "push: send failed");
      }
    }
  }

  if (dead.size > 0) {
    const { count } = await prisma.userSession.updateMany({
      where: { fcmToken: { in: [...dead] } },
      data: { fcmToken: null },
    });
    result.dropped = count;
  }

  return result;
}

/**
 * Remembers this device's token on the caller's own session.
 *
 * A token belongs to an app install, not a person: if another account signed
 * in on this phone before, its session still holds the same token and would
 * keep receiving that account's pushes here. So it is taken off every other
 * session first.
 */
export async function savePushToken(userId: string, sessionId: string, token: string): Promise<void> {
  await prisma.$transaction([
    prisma.userSession.updateMany({ where: { fcmToken: token, id: { not: sessionId } }, data: { fcmToken: null } }),
    prisma.userSession.updateMany({ where: { id: sessionId, userId }, data: { fcmToken: token } }),
  ]);
}

/**
 * Forgets the tokens of sessions that have expired. They are never sent to
 * (the flush only reads live sessions), but an ended session shouldn't keep
 * a device address either. Run by the every-minute job.
 */
export async function clearExpiredPushTokens(now = new Date()): Promise<number> {
  const { count } = await prisma.userSession.updateMany({
    where: { expiresAt: { lte: now }, fcmToken: { not: null } },
    data: { fcmToken: null },
  });
  return count;
}

/** Stops pushes to this device, e.g. when notifications are turned off on the phone. */
export async function clearPushToken(userId: string, sessionId: string): Promise<void> {
  await prisma.userSession.updateMany({ where: { id: sessionId, userId }, data: { fcmToken: null } });
}
