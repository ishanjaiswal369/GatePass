import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number }
) => Promise<Buffer>;

/**
 * scrypt, from Node's own crypto. No dependency to install and no native
 * module to build in the Alpine image, which is what bcrypt and argon2 both
 * bring with them.
 *
 * The cost parameters are stored inside the hash, so raising them later
 * applies to new passwords without invalidating existing ones: a login still
 * verifies against whatever N/r/p that row was written with.
 */
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scryptAsync(password, salt, KEY_LENGTH, { N, r: R, p: P });

  return [
    "scrypt",
    N,
    R,
    P,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

/**
 * Always compares in constant time, and returns false rather than throwing on
 * a malformed stored value -- a corrupt row should fail the login, not 500.
 */
export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const parts = stored.split("$");

  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }

  const [, n, r, p, saltPart, keyPart] = parts;
  const cost = { N: Number(n), r: Number(r), p: Number(p) };

  if (!Number.isFinite(cost.N) || !Number.isFinite(cost.r) || !Number.isFinite(cost.p)) {
    return false;
  }

  try {
    const salt = Buffer.from(saltPart!, "base64url");
    const expected = Buffer.from(keyPart!, "base64url");
    const actual = await scryptAsync(password, salt, expected.length, cost);

    // Lengths must match before timingSafeEqual, which throws otherwise.
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  } catch {
    return false;
  }
}
