import { z } from "zod";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

const createSettlementBody = z.object({
  organizerId: z.string().uuid(),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  grossAmount: z.number().nonnegative(),
  commissionAmount: z.number().nonnegative(),
  netPayable: z.number().nonnegative(),
});

const createSettlementItemBody = z.object({
  settlementId: z.string().uuid(),
  bookingId: z.string().uuid(),
  amount: z.number().nonnegative(),
  commissionDeducted: z.number().nonnegative(),
});

export const settlementRequests = {
  create: { body: createSettlementBody } satisfies RequestSchemas,
  createItem: { body: createSettlementItemBody } satisfies RequestSchemas,
};

export type CreateSettlementInput = RequestInput<typeof settlementRequests.create>;
export type CreateSettlementItemInput = RequestInput<
  typeof settlementRequests.createItem
>;
