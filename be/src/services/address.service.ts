import { prisma } from "../lib/prisma.js";

export interface SaveAddressInput {
  state: string;
  city: string;
  addressLine: string;
}

export async function get(userId: string) {
  return prisma.userAddress.findUnique({ where: { userId } });
}

/**
 * One address per user, so this is an upsert rather than separate create and
 * update endpoints -- the screen is a single form either way.
 *
 * `country` is not taken from the caller. The product is India-only and the
 * column carries the default; accepting it would let a client write a country
 * the rest of the system does not handle.
 */
export async function save(userId: string, input: SaveAddressInput) {
  return prisma.userAddress.upsert({
    where: { userId },
    create: { userId, ...input },
    update: input,
  });
}
