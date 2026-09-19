import { z } from "zod";
import { VEHICLE_TYPES } from "../constants/enums/index.js";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

const listCapacitiesQuery = z.object({
  listingId: z.string().uuid().optional(),
});

const createCapacityBody = z.object({
  listingId: z.string().uuid(),
  vehicleType: z.enum(VEHICLE_TYPES),
  // Printed on the driver's pass. Optional: a venue with one entrance has
  // nothing to print.
  gate: z.string().trim().min(1).max(40).optional(),
  totalCapacity: z.number().int().positive(),
  price: z.number().nonnegative(),
});

export const capacityRequests = {
  list: { query: listCapacitiesQuery } satisfies RequestSchemas,
  create: { body: createCapacityBody } satisfies RequestSchemas,
};

export type ListCapacitiesInput = RequestInput<typeof capacityRequests.list>;
export type CreateCapacityInput = RequestInput<typeof capacityRequests.create>;
