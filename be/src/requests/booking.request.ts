import { z } from "zod";
import { VEHICLE_TYPES } from "../constants/enums/index.js";
import { MAX_PAGE_SIZE } from "../lib/pagination.js";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

/**
 * driverId, amount and qrToken are absent by design. The driver comes from the
 * JWT, the price from ParkingCapacity and the token from the server -- see
 * booking.service. Anything accepted here is attacker-controlled.
 */
const createBookingBody = z.object({
  parkingCapacityId: z.string().uuid(),
  vehicleNumber: z.string().trim().min(1).max(32),
  quantity: z.number().int().positive().max(10),
  // Supplied by the app so a retried request after a dropped response
  // resolves to the same booking instead of a second one.
  idempotencyKey: z.string().min(8).max(128),
});

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
    { path: ["startsAt"], message: "cannot book a time in the past" }
  );

const listBookingsQuery = z.object({
  scope: z.enum(["upcoming", "past"]).default("upcoming"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).optional(),
});

const bookingIdParams = z.object({
  id: z.string().uuid(),
});

export const bookingRequests = {
  list: { query: listBookingsQuery } satisfies RequestSchemas,
  create: { body: createBookingBody } satisfies RequestSchemas,
  createSpot: { body: createSpotBookingBody } satisfies RequestSchemas,
  getById: { params: bookingIdParams } satisfies RequestSchemas,
  pass: { params: bookingIdParams } satisfies RequestSchemas,
};

export type ListBookingsInput = RequestInput<typeof bookingRequests.list>;
export type CreateBookingInput = RequestInput<typeof bookingRequests.create>;
export type CreateSpotBookingInput = RequestInput<
  typeof bookingRequests.createSpot
>;
export type GetBookingInput = RequestInput<typeof bookingRequests.getById>;
export type BookingPassInput = RequestInput<typeof bookingRequests.pass>;
