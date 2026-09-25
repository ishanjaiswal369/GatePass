import { z } from "zod";
import { LISTING_SECTIONS, PAYOUT_KYC_STATUSES } from "../constants/enums/index.js";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

const listingId = z.object({ id: z.string().uuid() });

const listQuery = z.object({
  status: z
    .enum(["PENDING_REVIEW", "PUBLISHED", "REJECTED", "SUSPENDED"])
    .default("PENDING_REVIEW"),
});

/**
 * A reason is required, not optional. A rejection the host cannot act on is
 * a dead end, and "rejected" with no text is exactly that.
 */
const reasonBody = z.object({
  reason: z.string().trim().min(1).max(500),
});

/** A rejection says what and where: the reason, and the wizard step to fix it in. */
const rejectBody = z
  .object({
    reason: z.string().trim().min(1).max(500),
    section: z.enum(LISTING_SECTIONS).optional(),
  })
  .strict();

const payoutStatusBody = z.object({
  hostProfileId: z.string().uuid(),
  status: z.enum(PAYOUT_KYC_STATUSES),
  payoutAccountId: z.string().trim().min(1).max(120).optional(),
});

export const adminSpotRequests = {
  list: { query: listQuery } satisfies RequestSchemas,
  getById: { params: listingId } satisfies RequestSchemas,
  approve: { params: listingId } satisfies RequestSchemas,
  reject: { params: listingId, body: rejectBody } satisfies RequestSchemas,
  ownershipDocument: { params: listingId } satisfies RequestSchemas,
  suspend: { params: listingId, body: reasonBody } satisfies RequestSchemas,
  setPayoutStatus: { body: payoutStatusBody } satisfies RequestSchemas,
};

export type ListSpotsInput = RequestInput<typeof adminSpotRequests.list>;
export type GetSpotInput = RequestInput<typeof adminSpotRequests.getById>;
export type ApproveSpotInput = RequestInput<typeof adminSpotRequests.approve>;
export type RejectSpotInput = RequestInput<typeof adminSpotRequests.reject>;
export type SuspendSpotInput = RequestInput<typeof adminSpotRequests.suspend>;
export type SetPayoutStatusInput = RequestInput<
  typeof adminSpotRequests.setPayoutStatus
>;
export type AdminOwnershipDocumentInput = RequestInput<typeof adminSpotRequests.ownershipDocument>;
