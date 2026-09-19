import type { User } from "@prisma/client";
import { env } from "../config/env.js";
import type {
  DeviceType,
  VerificationPurpose,
} from "../constants/enums/index.js";
import { getEmailProvider } from "../integrations/email/index.js";
import {
  GoogleIdentityError,
  GoogleNotConfiguredError,
  verifyGoogleIdToken,
} from "../integrations/google/verify.js";
import {
  badRequest,
  notFound,
  serviceUnavailable,
  tooManyRequests,
  unauthorized,
} from "../lib/errors.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { prisma } from "../lib/prisma.js";
import { createSession, revokeAllUserSessions } from "./session.service.js";
import * as hostService from "./host.service.js";
import { toAuthUser } from "./user.service.js";

/**
 * The user as the app keeps it in its session. Carries hasHostProfile on every
 * sign-in, not only on /auth/me, so the Host tab can choose onboarding or the
 * dashboard on first paint straight after logging in.
 */
async function sessionUser(user: User) {
  return {
    ...toAuthUser(user),
    hasHostProfile: await hostService.exists(user.id),
  };
}

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
  /** LOGIN unless a password flow asked for the code. */
  purpose?: VerificationPurpose;
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
  const purpose = input.purpose ?? "LOGIN";

  const now = Date.now();
  const windowStart = new Date(now - RATE_WINDOW_MINUTES * 60_000);

  // Rows older than the rate window can no longer be used or counted, so this
  // is where they get cleared. Deliberately does not touch rows inside the
  // window -- those are what the limit below counts.
  await prisma.emailVerification.deleteMany({
    where: { email, createdAt: { lt: windowStart } },
  });

  // Counted per purpose, so asking for a password reset cannot use up the
  // login allowance or vice versa.
  const recent = await prisma.emailVerification.findMany({
    where: { email, purpose, createdAt: { gte: windowStart } },
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
    data: {
      email,
      code,
      deviceId,
      deviceType,
      firstName,
      lastName,
      purpose,
      expiresAt,
    },
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
      // A password-reset code must never sign anyone in.
      purpose: "LOGIN",
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
    user: await sessionUser(user),
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
    user: await sessionUser(user),
    profileComplete: user.firstName !== null,
  };
}

/** Wrong guesses allowed against a password-reset code, same cap as login. */
const MAX_PASSWORD_ATTEMPTS = MAX_VERIFY_ATTEMPTS;

export interface RequestPasswordCodeInput {
  email: string;
  deviceId: string;
  deviceType: DeviceType;
}

/**
 * Mails a code for setting a password. Serves both entry points -- the profile
 * screen of a signed-in user, and forgot-password from the sign-in screen.
 *
 * Like requestCode, it answers the same way whether or not the address has an
 * account, so it cannot be used to discover which emails are registered. That
 * means an unknown address gets no mail but still gets a success response.
 */
export async function requestPasswordCode(
  input: RequestPasswordCodeInput
): Promise<{ code?: string }> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });

  if (!user) {
    return {};
  }

  return requestCode({ ...input, purpose: "PASSWORD_RESET" });
}

export interface SetPasswordInput {
  email: string;
  code: string;
  password: string;
  deviceId: string;
  deviceType: DeviceType;
  deviceName?: string;
  fcmToken?: string;
}

/**
 * Sets the password once the emailed code checks out.
 *
 * Every existing session is revoked and a fresh one issued. For
 * forgot-password that is the point -- whoever else was signed in is cut off
 * -- and it also means the signed-in profile flow ends holding a working
 * token instead of being logged out by its own success.
 */
export async function setPassword(input: SetPasswordInput) {
  const { email, code, password, deviceId, deviceType, deviceName, fcmToken } =
    input;

  const verification = await prisma.emailVerification.findFirst({
    where: {
      email,
      purpose: "PASSWORD_RESET",
      verified: false,
      expiresAt: { gt: new Date() },
      attempts: { lt: MAX_PASSWORD_ATTEMPTS },
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

    const remaining = MAX_PASSWORD_ATTEMPTS - attempts;

    if (remaining <= 0) {
      throw tooManyRequests("Too many incorrect attempts. Request a new code.");
    }

    throw badRequest(
      `Invalid code. ${remaining} attempt${remaining === 1 ? "" : "s"} left.`
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    // requestPasswordCode never mails an unknown address, so reaching here
    // means the account went away between the two calls.
    throw badRequest("Invalid or expired code");
  }

  await prisma.emailVerification.update({
    where: { id: verification.id },
    data: { verified: true },
  });

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(password),
      passwordSetAt: new Date(),
    },
  });

  await revokeAllUserSessions(user.id);

  const { token } = await createSession(
    { id: updated.id, email: updated.email, role: updated.role },
    { deviceId, deviceType, deviceName, fcmToken }
  );

  return {
    token,
    user: await sessionUser(updated),
    profileComplete: updated.firstName !== null,
  };
}

export interface LoginWithPasswordInput {
  email: string;
  password: string;
  deviceId: string;
  deviceType: DeviceType;
  deviceName?: string;
  fcmToken?: string;
}

/**
 * Signs in with email and password.
 *
 * A missing account and a wrong password answer identically, and an account
 * with no password still runs the hash comparison against a dummy value --
 * otherwise the response time alone says whether an address is registered and
 * whether it has a password set.
 */
export async function loginWithPassword(input: LoginWithPasswordInput) {
  const { email, password, deviceId, deviceType, deviceName, fcmToken } = input;

  const user = await prisma.user.findUnique({ where: { email } });

  const stored =
    user?.passwordHash ??
    // A real hash of a value nobody can supply, so the work is identical.
    "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

  const ok = await verifyPassword(password, stored);

  if (!user || !user.passwordHash || !ok) {
    throw unauthorized("Incorrect email or password");
  }

  const { token } = await createSession(
    { id: user.id, email: user.email, role: user.role },
    { deviceId, deviceType, deviceName, fcmToken }
  );

  return {
    token,
    user: await sessionUser(user),
    profileComplete: user.firstName !== null,
  };
}

/** Wrong current-password guesses allowed per user inside the window. */
const MAX_CHANGE_PASSWORD_FAILURES = 5;
const CHANGE_PASSWORD_WINDOW_MS = 15 * 60_000;

/**
 * Recent wrong current-password attempts, per user.
 *
 * Without a cap, anyone holding a stolen session could use this endpoint to
 * guess the account's password and then reuse it wherever the owner reuses
 * it. In memory is enough while the API runs as one process; it resets on
 * restart and would need moving to the database or Redis before running more
 * than one instance.
 */
const changePasswordFailures = new Map<string, number[]>();

function recentFailures(userId: string, now: number): number[] {
  const kept = (changePasswordFailures.get(userId) ?? []).filter(
    (at) => now - at < CHANGE_PASSWORD_WINDOW_MS
  );
  changePasswordFailures.set(userId, kept);
  return kept;
}

export interface ChangePasswordInput {
  userId: string;
  /** The caller's own session, which survives the change. */
  sessionId: string;
  currentPassword: string;
  newPassword: string;
}

/**
 * Changes the password of a signed-in user who can prove the current one.
 *
 * Unlike setPassword, the caller's own session is kept: they have just proven
 * who they are, and signing them out of the screen they are using would be
 * punishing the right person. Every other session is revoked, since a password
 * change is usually a reaction to someone else having it.
 *
 * A wrong current password answers 400, not 401. The session is valid; only
 * the password is wrong, and a 401 would read as "you are signed out".
 */
export async function changePassword(input: ChangePasswordInput) {
  const { userId, sessionId, currentPassword, newPassword } = input;
  const now = Date.now();

  const failures = recentFailures(userId, now);

  if (failures.length >= MAX_CHANGE_PASSWORD_FAILURES) {
    const retryAfter = Math.ceil(
      (failures[0]! + CHANGE_PASSWORD_WINDOW_MS - now) / 1000
    );
    throw tooManyRequests(
      `Too many incorrect attempts. Try again in ${Math.ceil(retryAfter / 60)} min.`
    );
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw notFound("User not found");
  }

  if (!user.passwordHash) {
    // Code-only and Google accounts have nothing to prove; they set a
    // password through the emailed-code flow instead.
    throw badRequest(
      "This account has no password yet. Set one with an emailed code."
    );
  }

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    failures.push(now);
    const remaining = MAX_CHANGE_PASSWORD_FAILURES - failures.length;
    throw badRequest(
      remaining > 0
        ? `Current password is incorrect. ${remaining} attempt${remaining === 1 ? "" : "s"} left.`
        : "Current password is incorrect."
    );
  }

  if (await verifyPassword(newPassword, user.passwordHash)) {
    throw badRequest("Choose a password different from your current one.");
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(newPassword),
      passwordSetAt: new Date(),
    },
  });

  const { count } = await prisma.userSession.deleteMany({
    where: { userId, id: { not: sessionId } },
  });

  changePasswordFailures.delete(userId);

  return { user: await sessionUser(updated), signedOutSessions: count };
}
