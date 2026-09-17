import { env } from "../config/env.js";
import { getSmsProvider } from "../integrations/sms/index.js";
import { badRequest } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { createSession } from "./session.service.js";

const OTP_TTL_MINUTES = 5;

export function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export interface RequestOtpInput {
  phone: string;
  deviceId: string;
  deviceType: "IOS" | "ANDROID" | "WEB" | "OTHER";
}

export async function requestOtp(
  input: RequestOtpInput
): Promise<{ otp?: string }> {
  const { phone, deviceId, deviceType } = input;

  const otp = generateOtp();
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + OTP_TTL_MINUTES);

  await prisma.otpVerification.create({
    data: { phone, code: otp, deviceId, deviceType, expiresAt },
  });

  try {
    await getSmsProvider().sendOtp({ to: phone, otp });
  } catch (error) {
    await prisma.otpVerification.deleteMany({ where: { phone, code: otp } });
    throw error;
  }

  const showOtp =
    getSmsProvider().name === "console" && env.SHOW_OTP_IN_RESPONSE;

  return { otp: showOtp ? otp : undefined };
}

export interface VerifyOtpInput {
  phone: string;
  otp: string;
  deviceId: string;
  deviceType: "IOS" | "ANDROID" | "WEB" | "OTHER";
  deviceName?: string;
  fcmToken?: string;
}

export async function verifyOtp(input: VerifyOtpInput) {
  const { phone, otp, deviceId, deviceType, deviceName, fcmToken } = input;

  const otpRecord = await prisma.otpVerification.findFirst({
    where: {
      phone,
      verified: false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!otpRecord) {
    throw badRequest("Invalid or expired OTP");
  }

  if (otpRecord.code !== otp) {
    throw badRequest("Invalid OTP");
  }

  await prisma.otpVerification.update({
    where: { id: otpRecord.id },
    data: { verified: true },
  });

  let user = await prisma.user.findUnique({ where: { phone } });

  if (!user) {
    user = await prisma.user.create({ data: { phone } });
  }

  const { token } = await createSession(
    { id: user.id, phone: user.phone, role: user.role },
    { deviceId, deviceType, deviceName, fcmToken }
  );

  return {
    token,
    user: {
      id: user.id,
      phone: user.phone,
      name: user.name,
      role: user.role,
    },
  };
}
