import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { notificationsApi } from "@/api";
import { colors } from "@/theme";

/**
 * Push notifications, through Firebase Cloud Messaging.
 *
 * The API sends to this phone's FCM token (be/src/integrations/push/fcm.ts),
 * kept on the signed-in session. Messages arrive data-only and
 * expo-notifications draws them, so a tap reaches the app even from cold.
 *
 * Only in a build of this app: Expo Go's token belongs to Expo's own Firebase
 * project, and the API's sends to it would be refused. Not on web either.
 */
export const PUSH_SUPPORTED =
  Platform.OS !== "web" && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

/** Must match CHANNEL_ID in the API's fcm.ts. */
const CHANNEL_ID = "default";

if (PUSH_SUPPORTED) {
  // With the app open, still show the banner: a "starts in 30 minutes" that
  // only lands in the inbox is easy to miss while looking at another screen.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Asks for permission if it hasn't been decided, then hands this phone's
 * token to the API. A refusal clears any token the session had, so the API
 * stops sending to a phone that said no.
 */
export async function registerForPush(sessionToken: string): Promise<void> {
  if (!PUSH_SUPPORTED) return;

  // Android 13+ only shows the permission prompt once a channel exists.
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "Bookings and reminders",
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: colors.ink,
    });
  }

  let { status, canAskAgain } = await Notifications.getPermissionsAsync();
  if (status !== "granted" && canAskAgain) {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== "granted") {
    await notificationsApi.clearPushToken(sessionToken).catch(() => undefined);
    return;
  }

  const { data } = await Notifications.getDevicePushTokenAsync();
  await notificationsApi.savePushToken(sessionToken, String(data));
}

/**
 * On sign-out: deletes this install's FCM token on the phone itself.
 *
 * The API drops the token with the session when logout reaches it, but a
 * sign-out without a connection never does. Deleting it here covers that:
 * FCM then refuses the old token, the API forgets it on its next send, and
 * the next sign-in registers a fresh one.
 */
export async function unregisterForPush(): Promise<void> {
  if (!PUSH_SUPPORTED) return;
  await Notifications.unregisterForNotificationsAsync();
}

/** The ids the API puts on every push (push-dispatch.service.ts). */
export interface PushData {
  notificationId?: string;
  kind?: string;
  bookingId?: string;
  listingId?: string;
}
