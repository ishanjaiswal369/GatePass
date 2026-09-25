import { z } from "zod";
import { NOTIFICATION_PREFERENCES } from "../constants/enums/index.js";
import { MAX_PAGE_SIZE } from "../lib/pagination.js";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

const listQuery = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).optional(),
});

/** Absent ids = everything. Capped, so one request can't name ten thousand. */
const readBody = z.object({ ids: z.array(z.string().uuid()).min(1).max(100).optional() }).strict();

/** Any subset of the switches, each a boolean; nothing else. */
const preferencesBody = z
  .object(Object.fromEntries(NOTIFICATION_PREFERENCES.map((key) => [key, z.boolean().optional()])) as Record<
    (typeof NOTIFICATION_PREFERENCES)[number],
    z.ZodOptional<z.ZodBoolean>
  >)
  .strict()
  .refine((value) => Object.values(value).some((v) => v !== undefined), { message: "change at least one setting" });

export const notificationRequests = {
  list: { query: listQuery } satisfies RequestSchemas,
  read: { body: readBody } satisfies RequestSchemas,
  preferences: { body: preferencesBody } satisfies RequestSchemas,
};

export type ListNotificationsInput = RequestInput<typeof notificationRequests.list>;
export type ReadNotificationsInput = RequestInput<typeof notificationRequests.read>;
export type NotificationPreferencesInput = RequestInput<typeof notificationRequests.preferences>;
