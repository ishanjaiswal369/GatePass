import { z } from "zod";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

/**
 * `country` is absent on purpose. The product is India-only, the column
 * defaults to it, and accepting it from the client would let a caller store a
 * country nothing downstream handles.
 */
const saveAddressBody = z.object({
  state: z.string().trim().min(1).max(100),
  city: z.string().trim().min(1).max(100),
  addressLine: z.string().trim().min(1).max(300),
});

export const addressRequests = {
  save: { body: saveAddressBody } satisfies RequestSchemas,
};

export type SaveAddressInput = RequestInput<typeof addressRequests.save>;
