import { logger } from "../../lib/logger.js";
import type { SendResult } from "../types.js";
import type {
  EmailProvider,
  SendEmailInput,
  SendLoginCodeInput,
} from "./provider.js";

export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console" as const;

  async sendLoginCode({ to, code }: SendLoginCodeInput): Promise<SendResult> {
    logger.info(
      { to, otp: code },
      "[email:console] login code generated (not actually sent)"
    );
    return { providerMessageId: `console-${Date.now()}` };
  }

  async send({ to, subject }: SendEmailInput): Promise<SendResult> {
    logger.info(
      { to, subject },
      "[email:console] message generated (not actually sent)"
    );
    return { providerMessageId: `console-${Date.now()}` };
  }
}
