import type { InboxEntry, Page } from "@/types/api.types";
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

/** This phone's FCM token, stored on the current session only. */
export const savePushToken = (token: string, pushToken: string) =>
  request<null>("/notifications/push-token", { method: "PUT", body: { token: pushToken }, token });

export const clearPushToken = (token: string) =>
  request<null>("/notifications/push-token", { method: "DELETE", token });
