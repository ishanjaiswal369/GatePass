import path from "node:path";
import { env } from "../../config/env.js";
import { ConsolePushProvider } from "./console.js";
import { FcmPushProvider } from "./fcm.js";
import type { PushProvider } from "./provider.js";

let cached: PushProvider | undefined;

export function getPushProvider(): PushProvider {
  if (cached) {
    return cached;
  }

  switch (env.PUSH_PROVIDER) {
    case "fcm":
      // Relative to the API's working directory (be/ locally, /app in Docker).
      cached = new FcmPushProvider(path.resolve(env.FIREBASE_SERVICE_ACCOUNT_FILE));
      break;
    case "console":
    default:
      cached = new ConsolePushProvider();
      break;
  }

  return cached;
}

export type { PushMessage, PushProvider, PushResult } from "./provider.js";
