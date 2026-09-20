import { z } from "zod";
import { SPACE_TYPES, VEHICLE_TYPES } from "../constants/enums/index.js";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

const MINUTES_IN_DAY = 24 * 60;

const listingId = z.object({ id: z.string().uuid() });

const createSpotBody = z.object({
  name: z.string().trim().min(1).max(120),
  venueName: z.string().trim().min(1).max(120),
  spaceType: z.enum(SPACE_TYPES),
});

const saveAddressBody = z.object({
  addressLine: z.string().trim().min(1).max(200),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  pincode: z.string().trim().regex(/^\d{6}$/, "must be a 6-digit pincode"),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  googlePlaceId: z.string().trim().min(1).max(200).optional(),
});

const presignBody = z.object({
  contentType: z.string().trim().min(1).max(100),
  contentLength: z.number().int().positive(),
});

const photosBody = z.object({
  // Order is the array order: the first URL becomes the cover photo.
  urls: z.array(z.string().url()).max(8),
});

const ownershipDocBody = z.object({
  url: z.string().url(),
});

const termsBody = z
  .object({
    accessInstructions: z.string().trim().min(1).max(1000).optional(),
    warrantyAccepted: z.literal(true).optional(),
  })
  .refine(
    (value) =>
      value.accessInstructions !== undefined || value.warrantyAccepted !== undefined,
    { message: "nothing to update" }
  );

const availabilityWindow = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(MINUTES_IN_DAY),
    endMinute: z.number().int().min(0).max(MINUTES_IN_DAY),
  })
  .refine((value) => value.startMinute < value.endMinute, {
    path: ["endMinute"],
    message: "must be after startMinute; split windows that cross midnight",
  });

const availabilityBody = z.object({
  windows: z.array(availabilityWindow).max(7 * 6),
});

const pricingBody = z.object({
  rates: z
    .array(
      z.object({
        vehicleType: z.enum(VEHICLE_TYPES),
        pricePerHour: z.number().positive().max(100000),
      })
    )
    .min(1),
});

export const spotListingRequests = {
  getById: { params: listingId } satisfies RequestSchemas,
  create: { body: createSpotBody } satisfies RequestSchemas,
  saveAddress: { params: listingId, body: saveAddressBody } satisfies RequestSchemas,
  presignPhoto: { params: listingId, body: presignBody } satisfies RequestSchemas,
  presignDoc: { params: listingId, body: presignBody } satisfies RequestSchemas,
  savePhotos: { params: listingId, body: photosBody } satisfies RequestSchemas,
  saveOwnershipDoc: {
    params: listingId,
    body: ownershipDocBody,
  } satisfies RequestSchemas,
  saveTerms: { params: listingId, body: termsBody } satisfies RequestSchemas,
  saveAvailability: {
    params: listingId,
    body: availabilityBody,
  } satisfies RequestSchemas,
  savePricing: { params: listingId, body: pricingBody } satisfies RequestSchemas,
  submit: { params: listingId } satisfies RequestSchemas,
};

export type GetSpotInput = RequestInput<typeof spotListingRequests.getById>;
export type CreateSpotInput = RequestInput<typeof spotListingRequests.create>;
export type SaveAddressInput = RequestInput<typeof spotListingRequests.saveAddress>;
export type PresignInput = RequestInput<typeof spotListingRequests.presignPhoto>;
export type SavePhotosInput = RequestInput<typeof spotListingRequests.savePhotos>;
export type SaveOwnershipDocInput = RequestInput<
  typeof spotListingRequests.saveOwnershipDoc
>;
export type SaveTermsInput = RequestInput<typeof spotListingRequests.saveTerms>;
export type SaveAvailabilityInput = RequestInput<
  typeof spotListingRequests.saveAvailability
>;
export type SavePricingInput = RequestInput<typeof spotListingRequests.savePricing>;
export type SubmitSpotInput = RequestInput<typeof spotListingRequests.submit>;
