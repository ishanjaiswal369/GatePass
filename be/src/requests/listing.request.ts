import { z } from "zod";
import { LISTING_TYPES } from "../constants/enums/index.js";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

const createListingBody = z.object({
  organizerId: z.string().uuid(),
  name: z.string().min(1),
  venueName: z.string().min(1),
  // INDEPENDENT_SPOT is excluded: a host spot belongs to a HostProfile and is
  // created by host onboarding, not by an organizer posting a listing.
  listingType: z
    .enum(LISTING_TYPES)
    .refine((value) => value !== "INDEPENDENT_SPOT", {
      message: "host spots are created through host onboarding",
    })
    .optional(),
  eventDate: z.coerce.date().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

export const listingRequests = {
  // No list schema: the scope comes from the caller's organizer memberships,
  // so there is nothing left in the query string to validate.
  create: { body: createListingBody } satisfies RequestSchemas,
};

export type CreateListingInput = RequestInput<typeof listingRequests.create>;
