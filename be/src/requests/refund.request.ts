import { z } from "zod";
import { REFUND_STATUSES } from "../constants/enums/index.js";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

/** Support's view of refunds at the gateway, and the retry of a failed one. */
export const refundRequests = {
  adminList: { query: z.object({ status: z.enum(REFUND_STATUSES).optional() }) } satisfies RequestSchemas,
  retry: { params: z.object({ id: z.string().uuid() }) } satisfies RequestSchemas,
};

export type AdminListRefundsInput = RequestInput<typeof refundRequests.adminList>;
export type RetryRefundInput = RequestInput<typeof refundRequests.retry>;
