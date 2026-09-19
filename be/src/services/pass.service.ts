import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { badRequest } from "../lib/errors.js";

/**
 * How long a displayed pass stays valid. Short enough that a screenshot
 * shared in a group chat is worthless within minutes, long enough that a
 * driver queueing at a gate does not have to refresh.
 */
const PASS_TTL_SECONDS = 5 * 60;

/** Marks the token as a gate pass so a session JWT can never be used as one. */
const PASS_TYPE = "gate-pass";

export interface GatePassClaims {
  typ: typeof PASS_TYPE;
  sub: string;
  /** Binds the pass to the booking's current qrToken. */
  fpr: string;
}

/**
 * A fingerprint of the durable token, never the token itself. Whatever is in
 * the QR is readable by anything that scans the screen, so the long-lived
 * secret stays on the server; rotating qrToken invalidates every pass already
 * issued for that booking.
 */
function fingerprint(qrToken: string): string {
  return createHash("sha256").update(qrToken).digest("base64url").slice(0, 22);
}

export interface IssuedPass {
  /** The payload to render as a QR code. */
  token: string;
  expiresAt: string;
  /** Seconds until expiry, so the app can schedule its own refresh. */
  expiresInSeconds: number;
}

export function issue(bookingId: string, qrToken: string): IssuedPass {
  const claims: GatePassClaims = {
    typ: PASS_TYPE,
    sub: bookingId,
    fpr: fingerprint(qrToken),
  };

  const token = jwt.sign(claims, env.JWT_SECRET, {
    expiresIn: PASS_TTL_SECONDS,
  });

  return {
    token,
    expiresAt: new Date(Date.now() + PASS_TTL_SECONDS * 1000).toISOString(),
    expiresInSeconds: PASS_TTL_SECONDS,
  };
}

/**
 * Checks a scanned pass. Used by the gate scanner, which is not built yet --
 * kept here so the signature and the type check live next to the code that
 * mints them rather than being reinvented against a different secret.
 */
export function verify(token: string, qrToken: string): GatePassClaims {
  let claims: GatePassClaims;

  try {
    claims = jwt.verify(token, env.JWT_SECRET) as GatePassClaims;
  } catch {
    throw badRequest("Pass is invalid or has expired");
  }

  if (claims.typ !== PASS_TYPE || claims.fpr !== fingerprint(qrToken)) {
    throw badRequest("Pass is invalid or has expired");
  }

  return claims;
}
