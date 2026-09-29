export interface PushMessage {
  /** The device's FCM registration token. */
  token: string;
  title: string;
  body: string;
  /**
   * Handed to the app with the notification, and used when it's tapped to
   * open the right screen. Ids only, never text another user typed.
   */
  data: Record<string, string>;
}

/**
 * What became of one send.
 *
 * `invalidToken` is its own outcome, not an error: the app was uninstalled or
 * its token rotated, so the token should be forgotten rather than retried.
 */
export type PushResult = { ok: true; providerMessageId: string } | { ok: false; invalidToken: true };

export interface PushProvider {
  readonly name: "fcm" | "console";
  send(message: PushMessage): Promise<PushResult>;
}
