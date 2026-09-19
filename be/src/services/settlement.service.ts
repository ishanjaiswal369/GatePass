import { prisma } from "../lib/prisma.js";

export interface CreateSettlementInput {
  organizerId?: string;
  hostProfileId?: string;
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

/** What an organizer is owed. Scoped to the organizers the caller works for. */
export async function listForOrganizers(organizerIds: string[]) {
  return prisma.settlement.findMany({
    where: { organizerId: { in: organizerIds } },
    include: { items: true },
    orderBy: { periodEnd: "desc" },
  });
}

/** What a host is owed. Hosts are paid by this same engine in v1. */
export async function listForHost(hostProfileId: string) {
  return prisma.settlement.findMany({
    where: { hostProfileId },
    include: { items: true },
    orderBy: { periodEnd: "desc" },
  });
}

export async function create(input: CreateSettlementInput, actorId: string) {
  return prisma.settlement.create({
    data: { ...input, createdBy: actorId, updatedBy: actorId },
  });
}

export async function listItems(settlementId: string) {
  return prisma.settlementItem.findMany({ where: { settlementId } });
}

export async function createItem(input: CreateSettlementItemInput) {
  return prisma.settlementItem.create({ data: input });
}
