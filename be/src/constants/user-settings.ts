/**
 * Every user setting, with its default.
 *
 * Mirrors the UserSettings model (prisma/schema/settings.prisma) column for
 * column: a setting is added in both places, and in the request schema
 * (requests/settings.request.ts), or it doesn't exist. Values are booleans
 * or strings only -- the type below enforces it. Mirrored in the app as
 * fe/src/types/api.types.ts `UserSettings`.
 */
export const DEFAULT_SETTINGS = {
  // Notifications: what to be told about.
  startingSoon: true,
  endingSoon: true,
  refunds: true,
  reviewReminders: true,
  hostNewBookings: true,
  hostPayouts: true,
  hostListing: true,
  // Notifications: how.
  push: true,
  email: true,
  offers: false,
} as const satisfies Record<string, boolean | string>;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;

/** The settings as stored and served: each key widened to its value's type. */
export type UserSettingsValues = {
  [K in SettingKey]: (typeof DEFAULT_SETTINGS)[K] extends boolean ? boolean : string;
};

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as SettingKey[];
