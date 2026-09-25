import { z } from "zod";
import { MONTHLY_TERMS } from "../config/pricing.js";
import { VEHICLE_TYPES } from "../constants/enums/index.js";
import type { RequestInput, RequestSchemas } from "../lib/request.js";
import { addDays, venueDate } from "../lib/venue-calendar.js";
import { normaliseVehicleNumber } from "../lib/vehicleNumber.js";

/** How far ahead a term may start. Further out, prices and hosts' plans are guesses. */
const MAX_LEAD_DAYS = 90;

const startDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "not a date")
  // Venue dates compare as strings: today onwards, at most 90 days out.
  .refine((v) => v >= venueDate(new Date()), "can't start in the past")
  .refine((v) => v <= addDays(venueDate(new Date()), MAX_LEAD_DAYS), `must start within ${MAX_LEAD_DAYS} days`);

/** "1,2,3,4,5" in a query string, or [1,2,3,4,5] in a body. */
const days = z
  .array(z.number().int().min(0).max(6))
  .min(1)
  .max(7)
  .refine((d) => new Set(d).size === d.length, "weekdays must be distinct");
const daysCsv = z
  .string()
  .transform((v) => v.split(",").map(Number))
  .pipe(days);

const minutes = {
  startMinute: z.coerce.number().int().min(0).max(1440),
  endMinute: z.coerce.number().int().min(0).max(1440),
};
const minutesOrdered = (v: { startMinute: number; endMinute: number }) => v.startMinute < v.endMinute;
const months = z.coerce
  .number()
  .int()
  .refine((m) => (MONTHLY_TERMS as readonly number[]).includes(m), `must be one of ${MONTHLY_TERMS.join(", ")}`);

const quoteQuery = z
  .object({ vehicleType: z.enum(VEHICLE_TYPES), startDate, months, days: daysCsv, ...minutes })
  .refine(minutesOrdered, { path: ["endMinute"], message: "must be after startMinute" });

/**
 * No price, fee or end date: those are computed from the spot's rate and
 * config. The driver comes from the token.
 */
const createBody = z
  .object({
    listingId: z.string().uuid(),
    vehicleType: z.enum(VEHICLE_TYPES),
    vehicleNumber: z.string().trim().min(1).max(32).transform(normaliseVehicleNumber),
    startDate,
    months,
    days,
    startMinute: z.number().int().min(0).max(1440),
    endMinute: z.number().int().min(0).max(1440),
    idempotencyKey: z.string().min(8).max(128),
  })
  .strict()
  .refine(minutesOrdered, { path: ["endMinute"], message: "must be after startMinute" });

const idParams = z.object({ id: z.string().uuid() });

export const monthlyRequests = {
  quote: { params: idParams, query: quoteQuery } satisfies RequestSchemas,
  create: { body: createBody } satisfies RequestSchemas,
  list: { query: z.object({ scope: z.enum(["current", "past"]).default("current") }) } satisfies RequestSchemas,
  get: { params: idParams } satisfies RequestSchemas,
  cancel: { params: idParams, body: z.object({ reason: z.string().trim().max(200).optional() }).strict() } satisfies RequestSchemas,
};

export type MonthlyQuoteInput = RequestInput<typeof monthlyRequests.quote>;
export type CreateMonthlyInput = RequestInput<typeof monthlyRequests.create>;
export type ListMonthlyInput = RequestInput<typeof monthlyRequests.list>;
export type GetMonthlyInput = RequestInput<typeof monthlyRequests.get>;
export type CancelMonthlyInput = RequestInput<typeof monthlyRequests.cancel>;
