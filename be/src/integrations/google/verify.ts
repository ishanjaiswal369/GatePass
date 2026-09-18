import { OAuth2Client } from "google-auth-library";
import { env } from "../../config/env.js";

export interface GoogleIdentity {
  /** Google's stable account id. Survives an email change. */
  googleId: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export class GoogleNotConfiguredError extends Error {
  constructor() {
    super("Google sign-in is not configured");
    this.name = "GoogleNotConfiguredError";
  }
}

export class GoogleIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleIdentityError";
  }
}

let client: OAuth2Client | undefined;

function getClient(): OAuth2Client {
  if (!client) {
    client = new OAuth2Client();
  }
  return client;
}

/**
 * Turns a client-supplied Google ID token into an identity we trust.
 *
 * Everything here is deliberate:
 * - verifyIdToken checks the signature against Google's published keys, the
 *   issuer and the expiry. A token cannot be forged or replayed past expiry.
 * - `audience` pins the token to our own OAuth clients. Without it, a token
 *   minted for any other Google app would authenticate here.
 * - email_verified is required. Google verifies gmail.com addresses, but a
 *   Workspace domain can hold unverified ones -- accepting those would let
 *   someone claim an address they do not own, and our sign-in matches on
 *   email.
 *
 * The client's own claim about who it is never enters the picture: the email
 * comes out of the verified payload, never from the request body.
 */
export async function verifyGoogleIdToken(
  idToken: string
): Promise<GoogleIdentity> {
  const audience = env.GOOGLE_CLIENT_IDS;

  if (audience.length === 0) {
    throw new GoogleNotConfiguredError();
  }

  let payload;

  try {
    const ticket = await getClient().verifyIdToken({ idToken, audience });
    payload = ticket.getPayload();
  } catch {
    // A bad signature, wrong audience and an expired token all land here. The
    // specific reason is deliberately not echoed back -- it only helps an
    // attacker tune their attempt. This is the caller's fault, not an upstream
    // outage, so it must surface as 401 rather than a 502.
    throw new GoogleIdentityError("Could not verify Google sign-in");
  }

  if (!payload) {
    throw new GoogleIdentityError("Google token carried no payload");
  }

  if (!payload.email) {
    throw new GoogleIdentityError("Google account has no email address");
  }

  if (!payload.email_verified) {
    throw new GoogleIdentityError("Google email address is not verified");
  }

  return {
    googleId: payload.sub,
    email: payload.email.trim().toLowerCase(),
    firstName: payload.given_name || undefined,
    lastName: payload.family_name || undefined,
  };
}

export const isGoogleConfigured = (): boolean =>
  env.GOOGLE_CLIENT_IDS.length > 0;
