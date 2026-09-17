import type { SendResult } from "../types.js";
import type {
  EmailProvider,
  SendEmailInput,
  SendLoginCodeInput,
} from "./provider.js";

export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console" as const;

  async sendLoginCode({ to, code }: SendLoginCodeInput): Promise<SendResult> {
    console.log(`[email:console] login code for ${to}: ${code} (not sent)`);
    return { providerMessageId: `console-${Date.now()}` };
  }

  async send({ to, subject }: SendEmailInput): Promise<SendResult> {
    console.log(`[email:console] "${subject}" to ${to} (not sent)`);
    return { providerMessageId: `console-${Date.now()}` };
  }
}
