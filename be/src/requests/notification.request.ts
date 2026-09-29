import { z } from "zod";
import { MAX_PAGE_SIZE } from "../lib/pagination.js";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

const listQuery = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).optional(),
});

/** Absent ids = everything. Capped, so one request can't name ten thousand. */
const readBody = z.object({ ids: z.array(z.string().uuid()).min(1).max(100).optional() }).strict();

/**
 * An FCM registration token: opaque, ~160 characters of [A-Za-z0-9_:-].
 * Bounded, so the column can't be used to store anything else.
 */
const pushTokenBody = z.object({ token: z.string().min(20).max(4096).regex(/^[\w:-]+$/) }).strict();

export const notificationRequests = {
  list: { query: listQuery } satisfies RequestSchemas,
  read: { body: readBody } satisfies RequestSchemas,
  pushToken: { body: pushTokenBody } satisfies RequestSchemas,
};

export type ListNotificationsInput = RequestInput<typeof notificationRequests.list>;
export type ReadNotificationsInput = RequestInput<typeof notificationRequests.read>;
export type PushTokenInput = RequestInput<typeof notificationRequests.pushToken>;
