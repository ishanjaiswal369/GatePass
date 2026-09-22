import { z } from "zod";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

const MINUTES_IN_DAY = 24 * 60;

const availabilityBody = z
  .object({
    listingId: z.string().uuid(),
    // 0 = Sunday .. 6 = Saturday, matching JS getDay().
    dayOfWeek: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(MINUTES_IN_DAY),
    endMinute: z.number().int().min(0).max(MINUTES_IN_DAY),
    isActive: z.boolean().optional(),
  })
  .refine((value) => value.startMinute < value.endMinute, {
    path: ["endMinute"],
    // A window crossing midnight has to be split into two rows, otherwise
    // every "is now inside this window" comparison needs a special case.
    message: "must be after startMinute; split windows that cross midnight",
  });

// listingId narrows which spot's windows come back; a partial update never
// moves a window to a different listing, so it has no place here.
const updateAvailabilityBody = availabilityBody
  .innerType()
  .omit({ listingId: true })
  .partial();

const listAvailabilityQuery = z.object({
  listingId: z.string().uuid().optional(),
});

const availabilityParams = z.object({
  id: z.string().uuid(),
});

export const hostRequests = {
  listAvailability: { query: listAvailabilityQuery } satisfies RequestSchemas,
  addAvailability: { body: availabilityBody } satisfies RequestSchemas,
  updateAvailability: {
    params: availabilityParams,
    body: updateAvailabilityBody,
  } satisfies RequestSchemas,
  removeAvailability: { params: availabilityParams } satisfies RequestSchemas,
};

export type ListAvailabilityInput = RequestInput<
  typeof hostRequests.listAvailability
>;
export type AddAvailabilityInput = RequestInput<
  typeof hostRequests.addAvailability
>;
export type UpdateAvailabilityInput = RequestInput<
  typeof hostRequests.updateAvailability
>;
export type RemoveAvailabilityInput = RequestInput<
  typeof hostRequests.removeAvailability
>;
