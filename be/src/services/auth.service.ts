import { env } from "../config/env.js";
import type { DeviceType } from "../constants/enums/index.js";
import { getEmailProvider } from "../integrations/email/index.js";
import { badRequest } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { createSession } from "./session.service.js";
import { toAuthUser } from "./user.service.js";

const CODE_TTL_MINUTES = 5;

export function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export interface RequestCodeInput {
  email: string;
  deviceId: string;
  deviceType: DeviceType;
  firstName?: string;
  lastName?: string;
}

/**
 * Sends a login code. Behaves identically whether or not the email already
 * has an account, so the response cannot be used to discover which addresses
 * are registered. A name sent from the signup screen is parked on the
 * verification row until the code is confirmed, so an unverified email never
 * creates a User row.
 */
export async function requestCode(
  input: RequestCodeInput
): Promise<{ code?: string }> {
  const { email, deviceId, deviceType, firstName, lastName } = input;

  const code = generateCode();
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + CODE_TTL_MINUTES);

  const verification = await prisma.emailVerification.create({
    data: { email, code, deviceId, deviceType, firstName, lastName, expiresAt },
  });

  try {
    await getEmailProvider().sendLoginCode({ to: email, code });
  } catch (error) {
    await prisma.emailVerification.delete({ where: { id: verification.id } });
    throw error;
  }

  const showCode =
    getEmailProvider().name === "console" && env.SHOW_OTP_IN_RESPONSE;

  return { code: showCode ? code : undefined };
}

export interface VerifyCodeInput {
  email: string;
  code: string;
  deviceId: string;
  deviceType: DeviceType;
  deviceName?: string;
  fcmToken?: string;
}

export async function verifyCode(input: VerifyCodeInput) {
  const { email, code, deviceId, deviceType, deviceName, fcmToken } = input;

  const verification = await prisma.emailVerification.findFirst({
    where: {
      email,
      verified: false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!verification) {
    throw badRequest("Invalid or expired code");
  }

  if (verification.code !== code) {
    throw badRequest("Invalid code");
  }

  await prisma.emailVerification.update({
    where: { id: verification.id },
    data: { verified: true },
  });

  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    // New account, created only now that the email is proven. The name is
    // absent when the code came from the sign-in screen; that user lands with
    // profileComplete false and is asked for a name next.
    user = await prisma.user.create({
      data: {
        email,
        firstName: verification.firstName,
        lastName: verification.lastName,
      },
    });
  }
  // Existing account: any submitted name is ignored on purpose. Signing up
  // again with a registered email signs you in rather than erroring, and must
  // not silently overwrite the name already on the account.

  const { token } = await createSession(
    { id: user.id, email: user.email, role: user.role },
    { deviceId, deviceType, deviceName, fcmToken }
  );

  return {
    token,
    user: toAuthUser(user),
    profileComplete: user.firstName !== null,
  };
}
