import { Prisma } from "@prisma/client";
import type { VehicleType } from "../constants/enums/index.js";
import { conflict, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

export interface SaveVehicleInput {
  /** Already normalised by the request layer. */
  vehicleNumber: string;
  vehicleType: VehicleType;
  label?: string | null;
  size?: string | null;
  isDefault?: boolean;
}

/**
 * Default first, then oldest first. Shared with /auth/me, which eager-loads
 * vehicles, so both places always list them in the same order.
 */
export const VEHICLE_ORDER: Prisma.VehicleOrderByWithRelationInput[] = [
  { isDefault: "desc" },
  { createdAt: "asc" },
];

/** Nothing internal here, so the whole row is safe to return. */
export async function list(userId: string) {
  return prisma.vehicle.findMany({
    where: { userId },
    orderBy: VEHICLE_ORDER,
  });
}

/**
 * "Default" has to be exactly one, so clearing the old one and setting the new
 * one happen in a single transaction -- otherwise a failure between them
 * leaves the user with two defaults or none.
 */
async function clearOtherDefaults(
  tx: Prisma.TransactionClient,
  userId: string,
  keepId?: string
) {
  await tx.vehicle.updateMany({
    where: { userId, isDefault: true, ...(keepId ? { NOT: { id: keepId } } : {}) },
    data: { isDefault: false },
  });
}

export async function create(userId: string, input: SaveVehicleInput) {
  try {
    return await prisma.$transaction(async (tx) => {
      const count = await tx.vehicle.count({ where: { userId } });
      // The first vehicle is the default whatever the caller said: a user with
      // one vehicle and no default would face a needless choice at checkout.
      const isDefault = count === 0 ? true : (input.isDefault ?? false);

      if (isDefault) {
        await clearOtherDefaults(tx, userId);
      }

      return tx.vehicle.create({
        data: {
          userId,
          vehicleNumber: input.vehicleNumber,
          vehicleType: input.vehicleType,
          label: input.label ?? null,
          size: input.vehicleType === "CAR" ? (input.size ?? null) : null,
          isDefault,
        },
      });
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw conflict("You have already saved this vehicle");
    }
    throw error;
  }
}

export async function update(
  id: string,
  userId: string,
  input: Partial<SaveVehicleInput>
) {
  // userId is part of the filter, so one user cannot edit another's vehicle
  // by id, and a wrong id is indistinguishable from someone else's.
  const owned = await prisma.vehicle.findFirst({
    where: { id, userId },
    select: { id: true },
  });

  if (!owned) {
    throw notFound("Vehicle not found");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await clearOtherDefaults(tx, userId, id);
      }

      // Turning a car into a bike drops its body size with it.
      const data = input.vehicleType && input.vehicleType !== "CAR" ? { ...input, size: null } : input;
      return tx.vehicle.update({ where: { id }, data });
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw conflict("You have already saved this vehicle");
    }
    throw error;
  }
}

export async function remove(id: string, userId: string) {
  const deleted = await prisma.vehicle.deleteMany({ where: { id, userId } });

  if (deleted.count === 0) {
    throw notFound("Vehicle not found");
  }

  // Removing the default leaves none, so the oldest remaining one takes over
  // rather than leaving checkout with nothing pre-selected.
  const remaining = await prisma.vehicle.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, isDefault: true },
  });

  if (remaining && !remaining.isDefault) {
    const anyDefault = await prisma.vehicle.count({
      where: { userId, isDefault: true },
    });

    if (anyDefault === 0) {
      await prisma.vehicle.update({
        where: { id: remaining.id },
        data: { isDefault: true },
      });
    }
  }
}
