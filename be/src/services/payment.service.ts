import type { PaymentStatus } from "../constants/enums.js";
import { prisma } from "../lib/prisma.js";

export interface CreatePaymentInput {
  bookingId: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  amount: number;
  status?: PaymentStatus;
}

export async function list() {
  return prisma.payment.findMany();
}

export async function create(input: CreatePaymentInput) {
  return prisma.payment.create({ data: input });
}
