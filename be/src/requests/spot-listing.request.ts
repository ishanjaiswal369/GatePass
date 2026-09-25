import { z } from "zod";
import {
  AMENITIES,
  ENTRY_METHODS,
  OWNERSHIP_DOC_TYPES,
  PERMISSION_BASES,
  SPACE_TYPES,
  VEHICLE_SIZES,
  VEHICLE_TYPES,
} from "../constants/enums/index.js";
import { NAME_EXAMPLE, promotionalNameReason } from "../lib/listing-name.js";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

const MINUTES_IN_DAY = 24 * 60;

/** 0 = Sunday .. 6 = Saturday, matching JS getDay(). */
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const listingId = z.object({ id: z.string().uuid() });

/** Strips control characters from free text a driver will later read. */
const plainText = (max: number) =>
  z
    .string()
    .transform((value) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim())
    .pipe(z.string().max(max));

/** Optional free text: absent leaves it, "" or null clears it. */
const optionalText = (max: number) =>
  plainText(max)
    .transform((value) => (value.length > 0 ? value : null))
    .nullable()
    .optional();

/**
 * What the space is called. It identifies the space and where it is; an
 * advert ("Best Parking in Pune!!!") is refused with a better example
 * (lib/listing-name).
 */
const listingName = z
  .string()
  .trim()
  .min(5, `must say what and where the space is, e.g. “${NAME_EXAMPLE}”`)
  .max(80)
  .superRefine((name, ctx) => {
    const reason = promotionalNameReason(name);
    if (reason) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${reason} For example: “${NAME_EXAMPLE}”.` });
  });

const createSpotBody = z.object({
  name: listingName,
  venueName: z.string().trim().min(1).max(120),
  // OTHER stays readable on older rows; the wizard no longer offers it.
  spaceType: z.enum(SPACE_TYPES).refine((type) => type !== "OTHER", "choose the type of space"),
  description: optionalText(300),
});

const saveAddressBody = z
  .object({
    /** Older clients: one line. Newer ones send the parts and the server composes it. */
    addressLine: z.string().trim().min(1).max(200).optional(),
    societyName: optionalText(120),
    building: optionalText(60),
    street: optionalText(200),
    area: z.string().trim().min(1).max(120).optional(),
    city: z.string().trim().min(1).max(100),
    state: z.string().trim().min(1).max(100),
    pincode: z.string().trim().regex(/^\d{6}$/, "must be a 6-digit pincode"),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    googlePlaceId: z.string().trim().min(1).max(200).optional(),
    pinConfirmed: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.addressLine || value.street || value.societyName || value.building, {
    path: ["street"],
    message: "add the street, or the society or building name",
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
    /** Public before booking ("Blue gate on the lane behind SBI"). Empty clears it. */
    entryPoint: plainText(120).optional(),
    warrantyAccepted: z.literal(true).optional(),
    entryMethod: z.enum(ENTRY_METHODS).optional(),
    /** Private until paid, like the instructions. */
    bayNumber: optionalText(20),
    parkingMarker: optionalText(120),
  })
  .strict()
  .refine((value) => Object.values(value).some((v) => v !== undefined), { message: "nothing to update" });

/** Feet are what hosts measure in; stored as cm. 1.5 m – 15 m covers a scooter bay to a van's. */
const bayCm = z.number().int().min(150).max(1500).nullable();

const detailsBody = z
  .object({
    covered: z.boolean(),
    amenities: z.array(z.enum(AMENITIES)).max(AMENITIES.length),
    amenityNote: optionalText(100).transform((value) => value ?? null),
    /** SUVs and vans are sizes of car: the list is CAR / BIKE. */
    vehicleTypes: z.array(z.enum(["CAR", "BIKE"])).min(1, "choose at least one vehicle").max(2),
    maxVehicleSize: z.enum(VEHICLE_SIZES).nullable(),
    maxVehicleHeightCm: z.number().int().min(100).max(500).nullable(),
    bayWidthCm: bayCm,
    bayLengthCm: bayCm,
    notes: optionalText(300).transform((value) => value ?? null),
  })
  .strict()
  .refine((value) => !value.vehicleTypes.includes("CAR") || value.maxVehicleSize !== null, {
    path: ["maxVehicleSize"],
    message: "say the largest car that fits",
  });

const MAX_STAY = 30 * MINUTES_IN_DAY;

const bookingRulesBody = z
  .object({
    minStayMinutes: z.number().int().min(15).max(MAX_STAY).nullable(),
    maxStayMinutes: z.number().int().min(60).max(MAX_STAY).nullable(),
    advanceDays: z.number().int().min(1).max(90).nullable(),
  })
  .strict()
  .refine((v) => v.minStayMinutes === null || v.maxStayMinutes === null || v.minStayMinutes <= v.maxStayMinutes, {
    path: ["maxStayMinutes"],
    message: "the longest stay can't be shorter than the shortest",
  });

const permissionBody = z
  .object({
    ownershipDocType: z.enum(OWNERSHIP_DOC_TYPES),
    permissionBasis: z.enum(PERMISSION_BASES),
    inSociety: z.boolean(),
    societyPermission: z.literal(true).optional(),
  })
  .strict();

const featuresBody = z
  .object({ amenities: z.array(z.enum(AMENITIES)).max(AMENITIES.length) })
  .strict();

const limitsBody = z
  .object({
    /** 1 m to 5 m: anything outside is a typo, not a garage. */
    maxVehicleHeightCm: z.number().int().min(100).max(500).nullable().optional(),
    maxVehicleSize: z.enum(VEHICLE_SIZES).nullable().optional(),
    rules: plainText(300)
      .transform((value) => (value.length > 0 ? value : null))
      .nullable()
      .optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((v) => v !== undefined), { message: "nothing to update" });

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

/**
 * The database refuses overlapping windows too (the EXCLUDE constraint in
 * migration 0023), and it is the one that has to, because two concurrent
 * requests can each pass a check the other invalidates. This is here anyway
 * so the common case -- one host, one payload, two windows they typed
 * themselves -- comes back naming the day it went wrong instead of as a
 * generic "two of these overlap".
 */
const availabilityBody = z.object({
  windows: z
    .array(availabilityWindow)
    .max(7 * 6)
    .superRefine((windows, ctx) => {
      const byDay = new Map<number, { startMinute: number; endMinute: number }[]>();

      for (const window of windows) {
        const sameDay = byDay.get(window.dayOfWeek) ?? [];

        if (
          sameDay.some(
            (other) =>
              window.startMinute < other.endMinute &&
              other.startMinute < window.endMinute
          )
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `two windows overlap on ${DAY_NAMES[window.dayOfWeek]}`,
          });
          return;
        }

        sameDay.push(window);
        byDay.set(window.dayOfWeek, sameDay);
      }
    }),
});

const pricingBody = z.object({
  rates: z
    .array(
      z.object({
        vehicleType: z.enum(VEHICLE_TYPES),
        // Whole rupees: a host sets ₹60, not ₹59.99.
        pricePerHour: z.number().int().positive().max(100000).optional(),
        pricePerDay: z.number().int().positive().max(1000000).optional(),
        pricePerMonth: z.number().int().positive().max(10000000).optional(),
      })
      .strict()
      .refine((row) => row.pricePerHour !== undefined || row.pricePerDay !== undefined || row.pricePerMonth !== undefined, {
        message: "set at least one of hourly, daily or monthly",
      })
    )
    .min(1),
});

export const spotListingRequests = {
  getById: { params: listingId } satisfies RequestSchemas,
  // The name is required here rather than on a later step, so that no row can
  // exist before the host has said what it is.
  create: { body: createSpotBody } satisfies RequestSchemas,
  delete: { params: listingId } satisfies RequestSchemas,
  saveType: { params: listingId, body: createSpotBody } satisfies RequestSchemas,
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
  saveFeatures: { params: listingId, body: featuresBody } satisfies RequestSchemas,
  saveLimits: { params: listingId, body: limitsBody } satisfies RequestSchemas,
  saveDetails: { params: listingId, body: detailsBody } satisfies RequestSchemas,
  saveBookingRules: { params: listingId, body: bookingRulesBody } satisfies RequestSchemas,
  savePermission: { params: listingId, body: permissionBody } satisfies RequestSchemas,
  ownershipDocument: { params: listingId } satisfies RequestSchemas,
  submit: { params: listingId } satisfies RequestSchemas,
};

export type GetSpotInput = RequestInput<typeof spotListingRequests.getById>;
export type CreateSpotInput = RequestInput<typeof spotListingRequests.create>;
export type DeleteSpotInput = RequestInput<typeof spotListingRequests.delete>;
export type SaveTypeInput = RequestInput<typeof spotListingRequests.saveType>;
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
export type SaveFeaturesInput = RequestInput<typeof spotListingRequests.saveFeatures>;
export type SaveLimitsInput = RequestInput<typeof spotListingRequests.saveLimits>;
export type SaveDetailsInput = RequestInput<typeof spotListingRequests.saveDetails>;
export type SaveBookingRulesInput = RequestInput<typeof spotListingRequests.saveBookingRules>;
export type SavePermissionInput = RequestInput<typeof spotListingRequests.savePermission>;
export type OwnershipDocumentInput = RequestInput<typeof spotListingRequests.ownershipDocument>;
