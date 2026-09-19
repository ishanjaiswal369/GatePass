import { z } from "zod";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

const createSettlementBody = z
  .object({
    organizerId: z.string().uuid().optional(),
    hostProfileId: z.string().uuid().optional(),
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
    grossAmount: z.number().nonnegative(),
    commissionAmount: z.number().nonnegative(),
    netPayable: z.number().nonnegative(),
  })
  .refine(
    (value) =>
      (value.organizerId === undefined) !== (value.hostProfileId === undefined),
    {
      path: ["organizerId"],
      // Mirrors the Settlement_one_payee CHECK. Money with two destinations or
      // none is a payout bug, so it is refused at both layers.
      message: "exactly one of organizerId or hostProfileId is required",
    }
  )
  .refine((value) => value.periodStart < value.periodEnd, {
    path: ["periodEnd"],
    message: "must be after periodStart",
  });

const createSettlementItemBody = z.object({
  settlementId: z.string().uuid(),
  bookingId: z.string().uuid(),
  amount: z.number().nonnegative(),
  commissionDeducted: z.number().nonnegative(),
});

const listSettlementItemsQuery = z.object({
  settlementId: z.string().uuid(),
});

export const settlementRequests = {
  create: { body: createSettlementBody } satisfies RequestSchemas,
  createItem: { body: createSettlementItemBody } satisfies RequestSchemas,
  listItems: { query: listSettlementItemsQuery } satisfies RequestSchemas,
};

export type CreateSettlementInput = RequestInput<typeof settlementRequests.create>;
export type CreateSettlementItemInput = RequestInput<
  typeof settlementRequests.createItem
>;
export type ListSettlementItemsInput = RequestInput<
  typeof settlementRequests.listItems
>;
