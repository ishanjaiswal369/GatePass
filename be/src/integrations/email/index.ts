import { env } from "../../config/env.js";
import { ConsoleEmailProvider } from "./console.js";
import { ResendEmailProvider } from "./resend.js";
import type { EmailProvider } from "./provider.js";

let cached: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  if (cached) {
    return cached;
  }

  switch (env.EMAIL_PROVIDER) {
    case "resend": {
      const apiKey = env.RESEND_API_KEY;
      if (!apiKey) {
        throw new Error("RESEND_API_KEY is required when EMAIL_PROVIDER=resend");
      }
      cached = new ResendEmailProvider({
        apiKey,
        from: env.EMAIL_FROM,
        fromName: env.EMAIL_FROM_NAME,
      });
      break;
    }
    case "console":
    default:
      cached = new ConsoleEmailProvider();
      break;
  }

  return cached;
}

export type { EmailProvider } from "./provider.js";
