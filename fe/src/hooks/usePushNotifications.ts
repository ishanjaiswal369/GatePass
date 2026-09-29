import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { notificationsApi } from "@/api";
import { PUSH_SUPPORTED, registerForPush, unregisterForPush, type PushData } from "@/lib/push";
import { useSession } from "@/providers/SessionProvider";

/**
 * Push, for the whole app: mounted once in the root layout.
 *
 * - Signed in: asks for permission (the first time) and registers this
 *   phone's token with the API, again whenever FCM rotates it.
 * - Signed out: deletes the token on the phone, so no push reaches a
 *   signed-out phone even if the logout call never got through.
 * - A tapped notification opens what it's about -- the booking, the same
 *   place the inbox opens -- and marks that inbox entry read. Works from cold
 *   too: the last response is kept until the app is up to read it.
 */
export function usePushNotifications(): void {
  const { token, isRestoring } = useSession();
  const handled = useRef<string | null>(null);
  // PUSH_SUPPORTED is fixed at load, so this is the same hook on every render.
  const response = PUSH_SUPPORTED ? Notifications.useLastNotificationResponse() : null;

  // Signed in this run, now signed out: a real sign-out, not a cold start
  // with no session. Only then is the phone's token deleted.
  const wasSignedIn = useRef(false);
  useEffect(() => {
    if (!PUSH_SUPPORTED) return;
    if (token) {
      wasSignedIn.current = true;
    } else if (wasSignedIn.current) {
      wasSignedIn.current = false;
      unregisterForPush().catch((error) => console.warn("[push] unregister failed", error));
    }
  }, [token]);

  useEffect(() => {
    if (!PUSH_SUPPORTED || !token) return;
    registerForPush(token).catch((error) => console.warn("[push] registration failed", error));

    const rotation = Notifications.addPushTokenListener(({ data }) => {
      notificationsApi.savePushToken(token, String(data)).catch(() => undefined);
    });
    return () => rotation.remove();
  }, [token]);

  useEffect(() => {
    // Wait for the session: a cold-start tap arrives before the stored token
    // is read back, and the booking screen needs it.
    if (!response || isRestoring || !token) return;
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;

    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;

    const data = (response.notification.request.content.data ?? {}) as PushData;
    if (data.notificationId) {
      notificationsApi.markRead(token, [data.notificationId]).catch(() => undefined);
    }
    if (data.bookingId) {
      router.push({ pathname: "/booking/[id]", params: { id: data.bookingId } });
    } else {
      router.push("/notifications");
    }
  }, [response, isRestoring, token]);
}
