import { z } from "zod";
import { VEHICLE_TYPES } from "../constants/enums/index.js";
import type { RequestInput, RequestSchemas } from "../lib/request.js";
import { normaliseVehicleNumber } from "../lib/vehicleNumber.js";

// Normalised at the boundary so the unique index actually prevents the same
// plate being saved twice in two spellings.
const vehicleNumberSchema = z.string().trim().transform(normaliseVehicleNumber);

const createVehicleBody = z.object({
  vehicleNumber: vehicleNumberSchema,
  vehicleType: z.enum(VEHICLE_TYPES),
  isDefault: z.boolean().optional(),
});

const updateVehicleBody = z
  .object({
    vehicleNumber: vehicleNumberSchema.optional(),
    vehicleType: z.enum(VEHICLE_TYPES).optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "provide at least one field to update",
  });

const vehicleParams = z.object({ id: z.string().uuid() });

export const vehicleRequests = {
  create: { body: createVehicleBody } satisfies RequestSchemas,
  update: { params: vehicleParams, body: updateVehicleBody } satisfies RequestSchemas,
  remove: { params: vehicleParams } satisfies RequestSchemas,
};

export type CreateVehicleInput = RequestInput<typeof vehicleRequests.create>;
export type UpdateVehicleInput = RequestInput<typeof vehicleRequests.update>;
export type RemoveVehicleInput = RequestInput<typeof vehicleRequests.remove>;
