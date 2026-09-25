import { Prisma, type User } from "@prisma/client";
import type { Role } from "../constants/enums/index.js";
import { conflict } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { VEHICLE_ORDER } from "./vehicle.service.js";

export interface CreateUserInput {
  email: string;
  firstName?: string;
  lastName?: string;
  role?: Role;
  phone?: string;
}

export interface UpdateProfileInput {
  firstName?: string;
  lastName?: string | null;
  /** Already normalised to +91XXXXXXXXXX by the request layer. */
  phone?: string;
}

/**
 * The user shape returned by the auth endpoints. Keeps /auth/me and
 * verify-code in agreement, and keeps internal columns out of responses.
 */
export function toAuthUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    // Whether a password exists, never the hash. The profile screen shows
    // "Set password" or "Change password" from this.
    hasPassword: user.passwordHash !== null,
  };
}

export async function list() {
  return prisma.user.findMany();
}

export async function getById(id: string) {
  return prisma.user.findUnique({ where: { id } });
}

/**
 * Everything the profile screen shows, in one query: the user plus vehicles,
 * address and whether a host profile exists. /auth/me returns this so the app
 * does not follow up with /vehicles and /address on every visit.
 */
export async function getProfile(id: string) {
  return prisma.user.findUnique({
    where: { id },
    include: {
      vehicles: { orderBy: VEHICLE_ORDER },
      address: true,
      hostProfile: { select: { id: true } },
    },
  });
}

export async function create(input: CreateUserInput) {
  return prisma.user.create({ data: input });
}

export async function updateProfile(id: string, input: UpdateProfileInput) {
  try {
    return await prisma.user.update({ where: { id }, data: input });
  } catch (error) {
    // phone is unique. Without this the caller sees a raw Prisma error
    // instead of being told the number is already on another account.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw conflict("That phone number is already in use");
    }
    throw error;
  }
}

/**
 * The Profile hub's counts: spaces saved, and live spaces for the Host chip.
 * Counted, not listed -- the hub only says how many.
 */
export async function profileCounts(userId: string, isHost: boolean) {
  const [savedCount, liveSpaces] = await Promise.all([
    prisma.favorite.count({ where: { userId } }),
    isHost
      ? prisma.listing.count({
          where: {
            hostProfile: { userId },
            listingType: "INDEPENDENT_SPOT",
            status: { in: ["PUBLISHED", "ONGOING"] },
          },
        })
      : Promise.resolve(0),
  ]);
  return { savedCount, liveSpaces };
}
