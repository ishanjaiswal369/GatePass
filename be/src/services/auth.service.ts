import { env } from "../config/env.js";
import type { DeviceType } from "../constants/enums/index.js";
import { getEmailProvider } from "../integrations/email/index.js";
import {
  GoogleIdentityError,
  GoogleNotConfiguredError,
  verifyGoogleIdToken,
} from "../integrations/google/verify.js";
import {
  badRequest,
  serviceUnavailable,
  tooManyRequests,
  unauthorized,
} from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { createSession } from "./session.service.js";
import { toAuthUser } from "./user.service.js";

const CODE_TTL_MINUTES = 5;

/** Shortest gap between two codes for one address. Blocks rapid-fire resends. */
const RESEND_COOLDOWN_SECONDS = 60;
/** Codes allowed per address inside the window below. */
const MAX_CODES_PER_WINDOW = 3;
const RATE_WINDOW_MINUTES = 15;
/** Wrong guesses allowed against a single code before it is burned. */
const MAX_VERIFY_ATTEMPTS = 5;

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

  const now = Date.now();
  const windowStart = new Date(now - RATE_WINDOW_MINUTES * 60_000);

  // Rows older than the rate window can no longer be used or counted, so this
  // is where they get cleared. Deliberately does not touch rows inside the
  // window -- those are what the limit below counts.
  await prisma.emailVerification.deleteMany({
    where: { email, createdAt: { lt: windowStart } },
  });

  const recent = await prisma.emailVerification.findMany({
    where: { email, createdAt: { gte: windowStart } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  if (recent.length >= MAX_CODES_PER_WINDOW) {
    const oldest = recent[recent.length - 1]!;
    const retryAfter = Math.ceil(
      (oldest.createdAt.getTime() + RATE_WINDOW_MINUTES * 60_000 - now) / 1000
    );
    throw tooManyRequests(
      `Too many codes requested for this email. Try again in ${retryAfter}s.`
    );
  }

  const last = recent[0];

  if (last) {
    const sinceLast = now - last.createdAt.getTime();
    if (sinceLast < RESEND_COOLDOWN_SECONDS * 1000) {
      const retryAfter = Math.ceil(
        (RESEND_COOLDOWN_SECONDS * 1000 - sinceLast) / 1000
      );
      throw tooManyRequests(
        `A code was just sent. Try again in ${retryAfter}s.`
      );
    }
  }

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
      // A row that has used up its guesses is no longer a candidate, so the
      // caller has to request a fresh code to keep trying.
      attempts: { lt: MAX_VERIFY_ATTEMPTS },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!verification) {
    throw badRequest("Invalid or expired code");
  }

  if (verification.code !== code) {
    const { attempts } = await prisma.emailVerification.update({
      where: { id: verification.id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });

    const remaining = MAX_VERIFY_ATTEMPTS - attempts;

    if (remaining <= 0) {
      throw tooManyRequests(
        "Too many incorrect attempts. Request a new code."
      );
    }

    throw badRequest(
      `Invalid code. ${remaining} attempt${remaining === 1 ? "" : "s"} left.`
    );
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

export interface GoogleSignInInput {
  idToken: string;
  deviceId: string;
  deviceType: DeviceType;
  deviceName?: string;
  fcmToken?: string;
}

/**
 * Signs in with a Google ID token, producing exactly the same session and
 * response shape as verifyCode -- the app treats both paths identically.
 *
 * Matching runs googleId first, then email:
 * - googleId is Google's stable account id, so a user who changes their Google
 *   address still resolves to the same row.
 * - Falling back to email links an existing email-code account to Google the
 *   first time they use the button. That is safe only because the identity is
 *   verified server-side and the address is confirmed verified by Google.
 *
 * The email is never taken from the request body -- only from the payload of
 * the token whose signature and audience we checked.
 */
export async function signInWithGoogle(input: GoogleSignInInput) {
  const { idToken, deviceId, deviceType, deviceName, fcmToken } = input;

  let identity;

  try {
    identity = await verifyGoogleIdToken(idToken);
  } catch (error) {
    if (error instanceof GoogleNotConfiguredError) {
      throw serviceUnavailable("Google sign-in is not available");
    }
    if (error instanceof GoogleIdentityError) {
      throw unauthorized(error.message);
    }
    throw error;
  }

  const { googleId, email, firstName, lastName } = identity;

  let user = await prisma.user.findUnique({ where: { googleId } });

  if (!user) {
    const byEmail = await prisma.user.findUnique({ where: { email } });

    if (byEmail) {
      // Existing email-code account adopts this Google identity. The name is
      // only filled where we have none -- an account's own name is never
      // overwritten, same rule as verifyCode.
      user = await prisma.user.update({
        where: { id: byEmail.id },
        data: {
          googleId,
          firstName: byEmail.firstName ?? firstName ?? null,
          lastName: byEmail.lastName ?? lastName ?? null,
        },
      });
    } else {
      user = await prisma.user.create({
        data: { email, googleId, firstName, lastName },
      });
    }
  }

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
