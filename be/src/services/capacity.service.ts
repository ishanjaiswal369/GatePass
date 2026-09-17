import { prisma } from "../lib/prisma.js";

export interface CreateCapacityInput {
  listingId: string;
  vehicleType: "CAR" | "BIKE" | "OTHER";
  totalCapacity: number;
  price: number;
}

export async function list() {
  return prisma.parkingCapacity.findMany();
}

export async function create(input: CreateCapacityInput) {
  return prisma.parkingCapacity.create({ data: input });
}
