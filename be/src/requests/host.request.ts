import { z } from "zod";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

const MINUTES_IN_DAY = 24 * 60;

const createHostProfileBody = z.object({
  addressLine: z.string().trim().min(1).max(200),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  pincode: z.string().trim().regex(/^\d{6}$/, "must be a 6-digit pincode"),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  // Format check only. Whether the PAN is real is a verification problem, and
  // verification is not automated yet.
  panNumber: z
    .string()
    .trim()
    .regex(/^[A-Z]{5}\d{4}[A-Z]$/, "must look like ABCDE1234F")
    .optional(),
  bankAccountId: z.string().trim().min(1).max(64).optional(),
});

// Shares its location fields with createHostProfileBody, minus panNumber and
// bankAccountId: those describe the host as a payee, once, not each spot.
const createListingBody = z.object({
  addressLine: z.string().trim().min(1).max(200),
  city: z.string().trim().min(1).max(100),
  pincode: z.string().trim().regex(/^\d{6}$/, "must be a 6-digit pincode"),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const listingParams = z.object({
  id: z.string().uuid(),
});

const availabilityBody = z
  .object({
    listingId: z.string().uuid(),
    // 0 = Sunday .. 6 = Saturday, matching JS getDay().
    dayOfWeek: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(MINUTES_IN_DAY),
    endMinute: z.number().int().min(0).max(MINUTES_IN_DAY),
    pricePerHour: z.number().positive(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => value.startMinute < value.endMinute, {
    path: ["endMinute"],
    // A window crossing midnight has to be split into two rows, otherwise
    // every "is now inside this window" comparison needs a special case.
    message: "must be after startMinute; split windows that cross midnight",
  });

// listingId narrows which spot's windows come back; a partial update never
// moves a window to a different listing, so it has no place here.
const updateAvailabilityBody = availabilityBody
  .innerType()
  .omit({ listingId: true })
  .partial();

const listAvailabilityQuery = z.object({
  listingId: z.string().uuid().optional(),
});

const availabilityParams = z.object({
  id: z.string().uuid(),
});

export const hostRequests = {
  createProfile: { body: createHostProfileBody } satisfies RequestSchemas,
  createListing: { body: createListingBody } satisfies RequestSchemas,
  deleteListing: { params: listingParams } satisfies RequestSchemas,
  listAvailability: { query: listAvailabilityQuery } satisfies RequestSchemas,
  addAvailability: { body: availabilityBody } satisfies RequestSchemas,
  updateAvailability: {
    params: availabilityParams,
    body: updateAvailabilityBody,
  } satisfies RequestSchemas,
  removeAvailability: { params: availabilityParams } satisfies RequestSchemas,
};

export type CreateHostProfileInput = RequestInput<
  typeof hostRequests.createProfile
>;
export type CreateListingInput = RequestInput<
  typeof hostRequests.createListing
>;
export type DeleteListingInput = RequestInput<
  typeof hostRequests.deleteListing
>;
export type ListAvailabilityInput = RequestInput<
  typeof hostRequests.listAvailability
>;
export type AddAvailabilityInput = RequestInput<
  typeof hostRequests.addAvailability
>;
export type UpdateAvailabilityInput = RequestInput<
  typeof hostRequests.updateAvailability
>;
export type RemoveAvailabilityInput = RequestInput<
  typeof hostRequests.removeAvailability
>;
