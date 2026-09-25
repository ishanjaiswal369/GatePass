import { z } from "zod";
import { MAX_PAGE_SIZE } from "../lib/pagination.js";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

/** Every rating, overall or not, is a whole number of stars. */
const stars = z.number().int().min(1).max(5);

export const MAX_COMMENT_LENGTH = 500;

/**
 * No driver, listing or booking in the body: the booking is the path param,
 * and the other two are read off it by the service. `.strict()` so a client
 * that sends a `driverId` finds out, rather than believing it counted.
 */
const createReviewBody = z
  .object({
    rating: stars,
    easyToFind: stars.optional(),
    asDescribed: stars.optional(),
    access: stars.optional(),
    comment: z
      .string()
      // Control characters (other than newlines and tabs) have no business in
      // a review someone else will read, and some of them break layouts.
      .transform((value) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim())
      .pipe(z.string().max(MAX_COMMENT_LENGTH))
      .transform((value) => (value.length > 0 ? value : undefined))
      .optional(),
  })
  .strict();

const bookingParams = z.object({ id: z.string().uuid() });
const spotParams = z.object({ id: z.string().uuid() });

const listQuery = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).optional(),
});

export const reviewRequests = {
  create: { params: bookingParams, body: createReviewBody } satisfies RequestSchemas,
  listForSpot: { params: spotParams, query: listQuery } satisfies RequestSchemas,
};

export type CreateReviewInput = RequestInput<typeof reviewRequests.create>;
export type ListSpotReviewsInput = RequestInput<typeof reviewRequests.listForSpot>;
