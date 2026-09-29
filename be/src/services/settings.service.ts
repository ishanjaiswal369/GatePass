import { DEFAULT_SETTINGS, type UserSettingsValues } from "../constants/user-settings.js";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/security-log.js";

/**
 * A user's settings (UserSettings).
 *
 * The row is created on the first change, so reading never writes: a user
 * without one has every default. Always the caller's own -- `userId` comes
 * from the session, never the request.
 */

export async function getSettings(userId: string): Promise<UserSettingsValues> {
  const row = await prisma.userSettings.findUnique({ where: { userId } });
  if (!row) return { ...DEFAULT_SETTINGS };
  const { id: _id, userId: _u, createdAt: _c, updatedAt: _up, ...settings } = row;
  return settings;
}

/** Changes only the keys given; the rest keep their stored value or default. */
export async function updateSettings(
  userId: string,
  patch: Partial<UserSettingsValues>
): Promise<UserSettingsValues> {
  await prisma.userSettings.upsert({
    where: { userId },
    update: patch,
    create: { userId, ...patch },
  });
  audit("USER_SETTINGS_CHANGED", { userId, changed: Object.keys(patch) });
  return getSettings(userId);
}
