import { z } from "zod";
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
  getById: { params: bookingIdParams } satisfies RequestSchemas,
  pass: { params: bookingIdParams } satisfies RequestSchemas,
};

export type ListBookingsInput = RequestInput<typeof bookingRequests.list>;
export type CreateBookingInput = RequestInput<typeof bookingRequests.create>;
export type GetBookingInput = RequestInput<typeof bookingRequests.getById>;
export type BookingPassInput = RequestInput<typeof bookingRequests.pass>;
