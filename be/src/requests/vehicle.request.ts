import { z } from "zod";
import { VEHICLE_SIZES, VEHICLE_TYPES } from "../constants/enums/index.js";
import type { RequestInput, RequestSchemas } from "../lib/request.js";
import { normaliseVehicleNumber } from "../lib/vehicleNumber.js";

// Normalised at the boundary so the unique index actually prevents the same
// plate being saved twice in two spellings.
const vehicleNumberSchema = z.string().trim().transform(normaliseVehicleNumber);

/** "Hyundai Creta". Free text, shown back only to its owner. */
const labelSchema = z
  .string()
  .transform((value) => value.replace(/[\u0000-\u001F\u007F]/g, "").trim())
  .pipe(z.string().max(60))
  .transform((value) => (value.length > 0 ? value : null));

/** A body size only means something for a car; a bike has none. */
const sizeOnlyForCars = (value: { vehicleType?: string; size?: string | null }) =>
  !value.size || value.vehicleType === undefined || value.vehicleType === "CAR";

const createVehicleBody = z
  .object({
    vehicleNumber: vehicleNumberSchema,
    vehicleType: z.enum(VEHICLE_TYPES),
    label: labelSchema.optional(),
    size: z.enum(VEHICLE_SIZES).nullable().optional(),
    isDefault: z.boolean().optional(),
  })
  .strict()
  .refine(sizeOnlyForCars, { path: ["size"], message: "only a car has a body size" });

const updateVehicleBody = z
  .object({
    vehicleNumber: vehicleNumberSchema.optional(),
    vehicleType: z.enum(VEHICLE_TYPES).optional(),
    label: labelSchema.optional(),
    size: z.enum(VEHICLE_SIZES).nullable().optional(),
    isDefault: z.boolean().optional(),
  })
  .strict()
  .refine(sizeOnlyForCars, { path: ["size"], message: "only a car has a body size" })
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
