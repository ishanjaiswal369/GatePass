import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";
import type { DeviceType } from "../constants/enums/index.js";
import { badRequest, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

const SESSION_DURATION_DAYS = 30;
/** The one algorithm tokens are signed and accepted with. */
export const JWT_ALGORITHM = "HS256" as const;
/** How stale `lastActiveAt` may get before a request refreshes it. */
const TOUCH_EVERY_MS = 60_000;

export interface DeviceInfo {
  deviceId: string;
  deviceType: DeviceType;
  deviceName?: string;
  fcmToken?: string;
}

export interface SessionPayload {
  userId: string;
  email: string;
  role: string;
  sessionId: string;
  deviceId: string;
  deviceType: string;
}

export async function createSession(
  user: { id: string; email: string; role: string },
  deviceInfo: DeviceInfo
): Promise<{ token: string; sessionId: string }> {
  const { deviceId, deviceType, deviceName, fcmToken } = deviceInfo;

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_DURATION_DAYS);

  const session = await prisma.userSession.upsert({
    where: {
      userId_deviceId: {
        userId: user.id,
        deviceId,
      },
    },
    update: {
      deviceType,
      deviceName,
      fcmToken,
      expiresAt,
      lastActiveAt: new Date(),
    },
    create: {
      userId: user.id,
      deviceId,
      deviceType,
      deviceName,
      fcmToken,
      expiresAt,
    },
  });

  const payload: SessionPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    sessionId: session.id,
    deviceId,
    deviceType,
  };

  const token = jwt.sign(payload, env.JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    // env validates the shape ("30d", "12h", ...). @types/jsonwebtoken models
    // this as a template-literal type from `ms`, which a plain string cannot
    // satisfy, so the cast stands in for that check.
    expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"],
  });

  return { token, sessionId: session.id };
}

/**
 * Who a token belongs to, or null when it is forged, expired, or its session
 * has been ended (logout, a remote sign-out, a password change).
 *
 * One read per request. `lastActiveAt` is what the Devices list shows, and a
 * minute's precision is plenty for that -- writing it on every request cost a
 * second round trip, and a row update, for each call the app makes.
 *
 * A database failure is thrown, not answered as "invalid token": the app
 * treats a 401 as signed out, and an outage must not sign everyone out.
 */
export async function getUserFromToken(
  token: string
): Promise<SessionPayload | null> {
  let payload: SessionPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET, { algorithms: [JWT_ALGORITHM] }) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.sessionId !== "string") return null;

  const session = await prisma.userSession.findUnique({
    where: { id: payload.sessionId },
    select: { expiresAt: true, lastActiveAt: true },
  });

  const now = new Date();
  if (!session || session.expiresAt < now) {
    return null;
  }

  if (now.getTime() - session.lastActiveAt.getTime() > TOUCH_EVERY_MS) {
    // updateMany: a session ended between the read and here is nothing to
    // touch, not an error.
    await prisma.userSession.updateMany({
      where: { id: payload.sessionId },
      data: { lastActiveAt: now },
    });
  }

  return payload;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.userSession
    .delete({ where: { id: sessionId } })
    .catch(() => {});
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await prisma.userSession.deleteMany({ where: { userId } });
}

export async function getUserSessions(userId: string) {
  return prisma.userSession.findMany({
    where: { userId },
    orderBy: { lastActiveAt: "desc" },
  });
}

export async function removeSession(
  sessionId: string,
  userId: string,
  currentSessionId: string
): Promise<void> {
  if (sessionId === currentSessionId) {
    throw badRequest("Use logout to end current session");
  }

  const deleted = await prisma.userSession.deleteMany({
    where: { id: sessionId, userId },
  });

  if (deleted.count === 0) {
    throw notFound("Session not found");
  }
}
