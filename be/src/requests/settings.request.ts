import { z } from "zod";
import type { SettingKey } from "../constants/user-settings.js";
import type { RequestInput, RequestSchemas } from "../lib/request.js";

/**
 * Any subset of the settings, each by name and its own type; nothing else.
 *
 * Listed one by one rather than generated, so a string setting added later
 * gets its own rule (an allowed list, a length) instead of "any string".
 * The `satisfies` keeps this list and constants/user-settings.ts in step.
 */
const settingFields = {
  startingSoon: z.boolean().optional(),
  endingSoon: z.boolean().optional(),
  refunds: z.boolean().optional(),
  reviewReminders: z.boolean().optional(),
  hostNewBookings: z.boolean().optional(),
  hostPayouts: z.boolean().optional(),
  hostListing: z.boolean().optional(),
  push: z.boolean().optional(),
  email: z.boolean().optional(),
  offers: z.boolean().optional(),
} satisfies Record<SettingKey, z.ZodTypeAny>;

const updateBody = z
  .object(settingFields)
  .strict()
  .refine((value) => Object.values(value).some((v) => v !== undefined), { message: "change at least one setting" });

export const settingsRequests = {
  update: { body: updateBody } satisfies RequestSchemas,
};

export type UpdateSettingsInput = RequestInput<typeof settingsRequests.update>;
