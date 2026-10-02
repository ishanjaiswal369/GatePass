import { z } from "zod";
import { VEHICLE_TYPES } from "../constants/enums/index.js";
import { EXTENSION_STEPS } from "../config/pricing.js";
import { MAX_PAGE_SIZE } from "../lib/pagination.js";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

/** The shortest stay worth selling, and the longest one this flow handles. */
const MIN_STAY_MINUTES = 15;
const MAX_STAY_MINUTES = 30 * 24 * 60;

/**
 * As above: the driver, the price and the token are all server-side. The
 * vehicle type is taken because it selects which of the spot's rates applies,
 * not because the caller gets to name a price.
 */
const createSpotBookingBody = z
  .object({
    listingId: z.string().uuid(),
    vehicleType: z.enum(VEHICLE_TYPES),
    vehicleNumber: z.string().trim().min(1).max(32),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    idempotencyKey: z.string().min(8).max(128),
  })
  .refine(
    (value) =>
      value.endsAt.getTime() - value.startsAt.getTime() >=
      MIN_STAY_MINUTES * 60_000,
    { path: ["endsAt"], message: `minimum stay is ${MIN_STAY_MINUTES} minutes` }
  )
  .refine(
    (value) =>
      value.endsAt.getTime() - value.startsAt.getTime() <=
      MAX_STAY_MINUTES * 60_000,
    { path: ["endsAt"], message: "that stay is too long to book here" }
  )
  .refine(
    // A small allowance, because the app sends a time the driver picked a
    // moment ago and a strict "in the future" would refuse the present.
    (value) => value.startsAt.getTime() > Date.now() - 5 * 60_000,
    { path: ["startsAt"], message: "That start time has already passed. Pick a later time." }
  );

const listBookingsQuery = z.object({
  scope: z.enum(["upcoming", "active", "past"]).default("upcoming"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).optional(),
});

const bookingIdParams = z.object({
  id: z.string().uuid(),
});

const cancelBookingBody = z
  .object({
    // Optional and free text; stored for the host and support, never shown
    // to anyone else.
    reason: z.string().trim().min(1).max(200).optional(),
  })
  .default({});

const createExtensionBody = z.object({
  minutes: z
    .number()
    .int()
    .refine((value) => (EXTENSION_STEPS as readonly number[]).includes(value), {
      message: `must be one of ${EXTENSION_STEPS.join(", ")}`,
    }),
  idempotencyKey: z.string().min(8).max(128),
});

export const bookingRequests = {
  list: { query: listBookingsQuery } satisfies RequestSchemas,
  createSpot: { body: createSpotBookingBody } satisfies RequestSchemas,
  getById: { params: bookingIdParams } satisfies RequestSchemas,
  cancellation: { params: bookingIdParams } satisfies RequestSchemas,
  cancel: { params: bookingIdParams, body: cancelBookingBody } satisfies RequestSchemas,
  extensionOptions: { params: bookingIdParams } satisfies RequestSchemas,
  createExtension: { params: bookingIdParams, body: createExtensionBody } satisfies RequestSchemas,
};

export type ListBookingsInput = RequestInput<typeof bookingRequests.list>;
export type CreateSpotBookingInput = RequestInput<
  typeof bookingRequests.createSpot
>;
export type GetBookingInput = RequestInput<typeof bookingRequests.getById>;
export type CancellationInput = RequestInput<typeof bookingRequests.cancellation>;
export type CancelBookingInput = RequestInput<typeof bookingRequests.cancel>;
export type ExtensionOptionsInput = RequestInput<typeof bookingRequests.extensionOptions>;
export type CreateExtensionInput = RequestInput<typeof bookingRequests.createExtension>;
