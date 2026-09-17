import { z } from "zod";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

const createBookingBody = z.object({
  parkingCapacityId: z.string().uuid(),
  driverId: z.string().uuid(),
  vehicleNumber: z.string().min(1),
  quantity: z.number().int().positive(),
  amount: z.number().nonnegative(),
  idempotencyKey: z.string().min(1),
  qrToken: z.string().min(1),
});

export const bookingRequests = {
  create: { body: createBookingBody } satisfies RequestSchemas,
};

export type CreateBookingInput = RequestInput<typeof bookingRequests.create>;
