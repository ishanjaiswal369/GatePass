import { z } from "zod";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

const spotParams = z.object({ id: z.string().uuid() });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD").refine((v) => !Number.isNaN(Date.parse(v)), "not a date");
const note = z
  .string()
  .transform((value) => value.replace(/[\u0000-\u001F\u007F]/g, "").trim())
  .pipe(z.string().max(100))
  .transform((value) => (value.length > 0 ? value : undefined))
  .optional();

/** The longest single block: a month. Longer is closing the space -- pause it. */
const MAX_BLOCK_MS = 31 * 24 * 60 * 60_000;

const blockBody = z
  .union([
    z.object({ kind: z.literal("range"), startsAt: z.coerce.date(), endsAt: z.coerce.date(), reason: note }).strict(),
    z.object({ kind: z.literal("day"), date: isoDate, freeOnly: z.boolean().default(false), reason: note }).strict(),
  ])
  .superRefine((value, ctx) => {
    if (value.kind !== "range") return;
    if (value.endsAt <= value.startsAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endsAt"], message: "must be after startsAt" });
    } else if (value.endsAt.getTime() - value.startsAt.getTime() > MAX_BLOCK_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsAt"],
        message: "a block can be at most 31 days; pause the space for longer",
      });
    }
  });

export const hostOperationsRequests = {
  overview: { params: spotParams } satisfies RequestSchemas,
  pause: { params: spotParams, body: z.object({ paused: z.boolean() }).strict() } satisfies RequestSchemas,
  bookings: {
    query: z.object({
      listingId: z.string().uuid().optional(),
      scope: z.enum(["upcoming", "active", "completed", "cancelled"]).default("upcoming"),
    }),
  } satisfies RequestSchemas,
  calendar: {
    params: spotParams,
    query: z.object({ from: isoDate, days: z.coerce.number().int().min(1).max(14).default(7) }),
  } satisfies RequestSchemas,
  createBlock: { params: spotParams, body: blockBody } satisfies RequestSchemas,
  removeBlock: { params: z.object({ id: z.string().uuid(), blockId: z.string().uuid() }) } satisfies RequestSchemas,
};

export type HostOverviewInput = RequestInput<typeof hostOperationsRequests.overview>;
export type HostPauseInput = RequestInput<typeof hostOperationsRequests.pause>;
export type HostBookingsInput = RequestInput<typeof hostOperationsRequests.bookings>;
export type HostCalendarInput = RequestInput<typeof hostOperationsRequests.calendar>;
export type HostCreateBlockInput = RequestInput<typeof hostOperationsRequests.createBlock>;
export type HostRemoveBlockInput = RequestInput<typeof hostOperationsRequests.removeBlock>;
