import { z } from "zod";
import { LISTING_TYPES } from "../constants/enums.js";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

const listListingsQuery = z.object({
  organizerId: z.string().uuid().optional(),
});

const createListingBody = z.object({
  organizerId: z.string().uuid(),
  name: z.string().min(1),
  venueName: z.string().min(1),
  listingType: z.enum(LISTING_TYPES).optional(),
  eventDate: z.coerce.date().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

export const listingRequests = {
  list: { query: listListingsQuery } satisfies RequestSchemas,
  create: { body: createListingBody } satisfies RequestSchemas,
};

export type ListListingsInput = RequestInput<typeof listingRequests.list>;
export type CreateListingInput = RequestInput<typeof listingRequests.create>;
