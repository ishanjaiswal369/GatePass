import { logger } from "../../lib/logger.js";
import type { SendResult } from "../types.js";
import type { SendOtpInput, SendSmsInput, SmsProvider } from "./provider.js";

export class ConsoleSmsProvider implements SmsProvider {
  readonly name = "console" as const;

  async sendOtp({ to, otp }: SendOtpInput): Promise<SendResult> {
    logger.info({ to, otp }, "[sms:console] OTP generated (not actually sent)");
    return { providerMessageId: `console-${Date.now()}` };
  }

  async send({ to, templateId, variables }: SendSmsInput): Promise<SendResult> {
    logger.info(
      { to, templateId, variables },
      "[sms:console] SMS generated (not actually sent)"
    );
    return { providerMessageId: `console-${Date.now()}` };
  }
}
