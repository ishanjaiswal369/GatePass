import type { UserSettings } from "@/types/api.types";
import { request } from "./client";

/** Every setting, stored or default. */
export const get = (token: string) => request<UserSettings>("/settings", { token });

/** Changes only the keys given; answers with the full settings after the change. */
export const update = (token: string, patch: Partial<UserSettings>) =>
  request<UserSettings>("/settings", { method: "PATCH", body: patch, token });
