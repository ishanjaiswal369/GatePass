import { z } from "zod";
import { VEHICLE_TYPES } from "../constants/enums.js";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

const createCapacityBody = z.object({
  listingId: z.string().uuid(),
  vehicleType: z.enum(VEHICLE_TYPES),
  totalCapacity: z.number().int().positive(),
  price: z.number().nonnegative(),
});

export const capacityRequests = {
  create: { body: createCapacityBody } satisfies RequestSchemas,
};

export type CreateCapacityInput = RequestInput<typeof capacityRequests.create>;
