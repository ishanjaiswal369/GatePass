import type { InboxEntry, NotificationPreferences, Page } from "@/types/api.types";
import { request } from "./client";

/** Newest first. The first page also brings due reminders into being, server side. */
export const list = (token: string, cursor?: string) =>
  request<Page<InboxEntry> & { unread: number }>(
    `/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    { token }
  );

export const unreadCount = (token: string) => request<{ unread: number }>("/notifications/unread-count", { token });

/** No ids marks everything read. */
export const markRead = (token: string, ids?: string[]) =>
  request<{ updated: number }>("/notifications/read", { method: "POST", body: ids ? { ids } : {}, token });

export const preferences = (token: string) => request<NotificationPreferences>("/notifications/preferences", { token });

export const updatePreferences = (token: string, patch: Partial<NotificationPreferences>) =>
  request<NotificationPreferences>("/notifications/preferences", { method: "PUT", body: patch, token });
