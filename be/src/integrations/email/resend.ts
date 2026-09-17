import { IntegrationError } from "../errors.js";
import { http, withRetry } from "../http.js";
import type { SendResult } from "../types.js";
import type {
  EmailProvider,
  SendEmailInput,
  SendLoginCodeInput,
} from "./provider.js";

const CAPABILITY = "email";
const SEND_ENDPOINT = "https://api.resend.com/emails";
const CODE_TTL_MINUTES = 5;

export interface ResendConfig {
  apiKey: string;
  from: string;
  fromName?: string;
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend" as const;

  constructor(private readonly config: ResendConfig) {}

  async sendLoginCode({ to, code }: SendLoginCodeInput): Promise<SendResult> {
    return this.send({
      to,
      subject: "Your GatePass login code",
      text: `${code} is your GatePass verification code. It expires in ${CODE_TTL_MINUTES} minutes.`,
      html: `<p><strong>${code}</strong> is your GatePass verification code. It expires in ${CODE_TTL_MINUTES} minutes.</p>`,
    });
  }

  async send({ to, subject, html, text }: SendEmailInput): Promise<SendResult> {
    const { from, fromName } = this.config;
    const fromHeader = fromName ? `${fromName} <${from}>` : from;

    return withRetry(async () => {
      try {
        const response = await http.post(
          SEND_ENDPOINT,
          { from: fromHeader, to: [to], subject, html, text },
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.config.apiKey}`,
            },
          }
        );
        return this.readResult(response.data);
      } catch (error) {
        throw IntegrationError.from(
          { capability: CAPABILITY, provider: this.name, operation: "send" },
          error
        );
      }
    });
  }

  private readResult(data: unknown): SendResult {
    const payload = data as { id?: string; message?: string } | undefined;

    if (!payload?.id) {
      throw new IntegrationError(payload?.message || "Resend request failed", {
        capability: CAPABILITY,
        provider: this.name,
        operation: "send",
        retryable: false,
        raw: payload,
      });
    }

    return { providerMessageId: payload.id };
  }
}
