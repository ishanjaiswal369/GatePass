import { badRequest } from "./errors.js";

/**
 * Keyset (cursor) pagination rather than offset.
 *
 * The driver feed is ordered by a date that new rows land in the middle of, so
 * an offset page would skip or repeat rows the moment an organizer publishes
 * while someone is scrolling. A cursor points at the last row of the previous
 * page, so the next page always continues from a fixed position.
 *
 * The encoded value is opaque on purpose -- callers pass back what they were
 * given and nothing more.
 */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export function encodeCursor(parts: (string | number)[]): string {
  return Buffer.from(JSON.stringify(parts), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string, expectedLength: number): string[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw badRequest("Invalid cursor");
  }

  if (!Array.isArray(parsed) || parsed.length !== expectedLength) {
    throw badRequest("Invalid cursor");
  }

  return parsed.map(String);
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;
