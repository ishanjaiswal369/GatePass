import { readFileSync } from "node:fs";
import axios from "axios";
import { GoogleAuth } from "google-auth-library";
import { IntegrationError } from "../errors.js";
import { http, withRetry } from "../http.js";
import type { PushMessage, PushProvider, PushResult } from "./provider.js";

const CAPABILITY = "push";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
/** Android notification channel the app creates (fe/src/lib/push.ts). */
const CHANNEL_ID = "default";
/** Brand ink, for the small icon's tint in the notification shade. */
const ACCENT = "#111827";

/**
 * FCM errors that mean "this token will never work again": the app was
 * uninstalled, its data cleared, or the token was minted for another Firebase
 * project. Anything else (quota, 5xx) is a failure to retry, not a dead token.
 */
const DEAD_TOKEN_CODES = new Set(["UNREGISTERED", "SENDER_ID_MISMATCH"]);

interface FcmErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: { "@type"?: string; errorCode?: string }[];
  };
}

/**
 * Firebase Cloud Messaging, HTTP v1 API.
 *
 * Authenticated with a service-account key through google-auth-library,
 * which caches the OAuth token and refreshes it before it expires.
 *
 * Messages are data-only on purpose. With a `notification` block Android shows
 * a background notification itself, and a tap on it never reaches the app's
 * JavaScript; data-only, expo-notifications builds and shows it, so the tap is
 * delivered and opens the booking. The keys are the ones expo-notifications
 * reads (NotificationData.kt): title, message, body (JSON, becomes `data`).
 */
export class FcmPushProvider implements PushProvider {
  readonly name = "fcm" as const;
  private readonly auth: GoogleAuth;
  private readonly endpoint: string;

  constructor(serviceAccountFile: string) {
    let projectId: string | undefined;
    try {
      projectId = (JSON.parse(readFileSync(serviceAccountFile, "utf8")) as { project_id?: string }).project_id;
    } catch (error) {
      throw new Error(
        `PUSH_PROVIDER=fcm, but the service-account key at ${serviceAccountFile} can't be read: ` +
          (error instanceof Error ? error.message : String(error))
      );
    }
    if (!projectId) {
      throw new Error(`${serviceAccountFile} has no project_id -- is it a Firebase service-account key?`);
    }

    this.auth = new GoogleAuth({ keyFile: serviceAccountFile, scopes: [SCOPE] });
    this.endpoint = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  }

  async send({ token, title, body, data }: PushMessage): Promise<PushResult> {
    const message = {
      token,
      data: {
        title,
        message: body,
        body: JSON.stringify(data),
        channelId: CHANNEL_ID,
        color: ACCENT,
      },
      // High, or a dozing phone holds it until the next maintenance window --
      // "your parking starts in 30 minutes" arriving an hour late.
      android: { priority: "HIGH" },
    };

    return withRetry(async () => {
      try {
        const accessToken = await this.auth.getAccessToken();
        const response = await http.post(
          this.endpoint,
          { message },
          { headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` } }
        );
        return { ok: true as const, providerMessageId: String((response.data as { name?: string }).name ?? "") };
      } catch (error) {
        const fcm = axios.isAxiosError(error) ? (error.response?.data as FcmErrorBody | undefined)?.error : undefined;
        const code = fcm?.details?.find((d) => d.errorCode)?.errorCode;

        if (code && DEAD_TOKEN_CODES.has(code)) {
          return { ok: false as const, invalidToken: true as const };
        }
        // A malformed token comes back as a bare INVALID_ARGUMENT naming it.
        if (fcm?.status === "INVALID_ARGUMENT" && /registration token/i.test(fcm.message ?? "")) {
          return { ok: false as const, invalidToken: true as const };
        }

        if (fcm) {
          const status = axios.isAxiosError(error) ? error.response?.status : undefined;
          throw new IntegrationError(fcm.message ?? `FCM ${fcm.status ?? "error"}`, {
            capability: CAPABILITY,
            provider: this.name,
            operation: "send",
            retryable: status === undefined || status >= 500 || status === 429,
            statusCode: status,
            raw: fcm,
          });
        }
        throw IntegrationError.from({ capability: CAPABILITY, provider: this.name, operation: "send" }, error);
      }
    });
  }
}
