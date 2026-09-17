import { env } from "../../config/env.js";
import { ConsoleSmsProvider } from "./console.js";
import { Msg91SmsProvider } from "./msg91.js";
import type { SmsProvider } from "./provider.js";

let cached: SmsProvider | undefined;

export function getSmsProvider(): SmsProvider {
  if (cached) {
    return cached;
  }

  switch (env.SMS_PROVIDER) {
    case "msg91": {
      const authKey = env.MSG91_AUTH_KEY;
      if (!authKey) {
        throw new Error("MSG91_AUTH_KEY is required when SMS_PROVIDER=msg91");
      }
      cached = new Msg91SmsProvider({
        authKey,
        senderId: env.MSG91_SENDER_ID,
        templateId: env.MSG91_TEMPLATE_ID,
      });
      break;
    }
    case "console":
    default:
      cached = new ConsoleSmsProvider();
      break;
  }

  return cached;
}

export type { SmsProvider } from "./provider.js";
