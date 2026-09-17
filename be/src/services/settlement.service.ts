import { prisma } from "../lib/prisma.js";

export interface CreateSettlementInput {
  organizerId: string;
  periodStart: Date;
  periodEnd: Date;
  grossAmount: number;
  commissionAmount: number;
  netPayable: number;
}

export interface CreateSettlementItemInput {
  settlementId: string;
  bookingId: string;
  amount: number;
  commissionDeducted: number;
}

export async function list() {
  return prisma.settlement.findMany({ include: { items: true } });
}

export async function create(input: CreateSettlementInput) {
  return prisma.settlement.create({ data: input });
}

export async function listItems() {
  return prisma.settlementItem.findMany();
}

export async function createItem(input: CreateSettlementItemInput) {
  return prisma.settlementItem.create({ data: input });
}
