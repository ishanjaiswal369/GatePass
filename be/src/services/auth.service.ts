import { env } from "../config/env.js";
import { getEmailProvider } from "../integrations/email/index.js";
import { badRequest } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { createSession } from "./session.service.js";

const OTP_TTL_MINUTES = 5;

export function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export interface RequestOtpInput {
  email: string;
  deviceId: string;
  deviceType: "IOS" | "ANDROID" | "WEB" | "OTHER";
}

export async function requestOtp(
  input: RequestOtpInput
): Promise<{ otp?: string }> {
  const { email, deviceId, deviceType } = input;

  const otp = generateOtp();
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + OTP_TTL_MINUTES);

  const verification = await prisma.emailVerification.create({
    data: { email, code: otp, deviceId, deviceType, expiresAt },
  });

  try {
    await getEmailProvider().sendLoginCode({ to: email, code: otp });
  } catch (error) {
    await prisma.emailVerification.delete({
      where: { id: verification.id },
    });
    throw error;
  }

  const showOtp =
    getEmailProvider().name === "console" && env.SHOW_OTP_IN_RESPONSE;

  return { otp: showOtp ? otp : undefined };
}

export interface VerifyOtpInput {
  email: string;
  otp: string;
  deviceId: string;
  deviceType: "IOS" | "ANDROID" | "WEB" | "OTHER";
  deviceName?: string;
  fcmToken?: string;
}

export async function verifyOtp(input: VerifyOtpInput) {
  const { email, otp, deviceId, deviceType, deviceName, fcmToken } = input;

  const verification = await prisma.emailVerification.findFirst({
    where: {
      email,
      verified: false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!verification) {
    throw badRequest("Invalid or expired OTP");
  }

  if (verification.code !== otp) {
    throw badRequest("Invalid OTP");
  }

  await prisma.emailVerification.update({
    where: { id: verification.id },
    data: { verified: true },
  });

  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    user = await prisma.user.create({ data: { email } });
  }

  const { token } = await createSession(
    { id: user.id, email: user.email, role: user.role },
    { deviceId, deviceType, deviceName, fcmToken }
  );

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      name: user.name,
      role: user.role,
    },
  };
}
