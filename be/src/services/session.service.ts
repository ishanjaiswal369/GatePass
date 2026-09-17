import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { badRequest, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

const SESSION_DURATION_DAYS = 30;

export interface DeviceInfo {
  deviceId: string;
  deviceType: "IOS" | "ANDROID" | "WEB" | "OTHER";
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
    expiresIn: env.JWT_EXPIRES_IN,
  });

  return { token, sessionId: session.id };
}

export async function getUserFromToken(
  token: string
): Promise<SessionPayload | null> {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as SessionPayload;

    const session = await prisma.userSession.findUnique({
      where: { id: payload.sessionId },
    });

    if (!session || session.expiresAt < new Date()) {
      return null;
    }

    await prisma.userSession.update({
      where: { id: payload.sessionId },
      data: { lastActiveAt: new Date() },
    });

    return payload;
  } catch {
    return null;
  }
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
