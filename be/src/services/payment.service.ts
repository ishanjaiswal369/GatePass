import { prisma } from "../lib/prisma.js";

export interface CreatePaymentInput {
  bookingId: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  amount: number;
  status?: "CREATED" | "CAPTURED" | "FAILED" | "REFUNDED";
}

export async function list() {
  return prisma.payment.findMany();
}

export async function create(input: CreatePaymentInput) {
  return prisma.payment.create({ data: input });
}
