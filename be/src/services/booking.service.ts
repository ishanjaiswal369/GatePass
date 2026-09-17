import { prisma } from "../lib/prisma.js";

export interface CreateBookingInput {
  parkingCapacityId: string;
  driverId: string;
  vehicleNumber: string;
  quantity: number;
  amount: number;
  idempotencyKey: string;
  qrToken: string;
}

export async function list() {
  return prisma.booking.findMany({
    include: { driver: true, parkingCapacity: true },
  });
}

export async function create(input: CreateBookingInput) {
  return prisma.booking.create({ data: input });
}
