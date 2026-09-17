import { IntegrationError } from "../errors.js";
import { http, withRetry } from "../http.js";
import { toE164 } from "../phone.js";
import type { SendResult } from "../types.js";
import type { SendOtpInput, SendSmsInput, SmsProvider } from "./provider.js";

const CAPABILITY = "sms";
const OTP_ENDPOINT = "https://api.msg91.com/api/v5/otp";
const FLOW_ENDPOINT = "https://api.msg91.com/api/v5/flow/";

export interface Msg91Config {
  authKey: string;
  senderId: string;
  templateId?: string;
}

export class Msg91SmsProvider implements SmsProvider {
  readonly name = "msg91" as const;

  constructor(private readonly config: Msg91Config) {}

  async sendOtp({ to, otp }: SendOtpInput): Promise<SendResult> {
    const body = new URLSearchParams({
      authkey: this.config.authKey,
      mobile: toE164(to),
      otp,
      sender: this.config.senderId,
    });

    if (this.config.templateId) {
      body.append("template_id", this.config.templateId);
    }

    return withRetry(async () => {
      try {
        const response = await http.post(OTP_ENDPOINT, body, {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            authkey: this.config.authKey,
          },
        });
        return this.readResult(response.data, "sendOtp");
      } catch (error) {
        throw IntegrationError.from(
          { capability: CAPABILITY, provider: this.name, operation: "sendOtp" },
          error
        );
      }
    });
  }

  async send({ to, templateId, variables }: SendSmsInput): Promise<SendResult> {
    const resolvedTemplateId = templateId ?? this.config.templateId;
    if (!resolvedTemplateId) {
      throw new IntegrationError("MSG91 template id is not configured", {
        capability: CAPABILITY,
        provider: this.name,
        operation: "send",
        retryable: false,
      });
    }

    return withRetry(async () => {
      try {
        const response = await http.post(
          FLOW_ENDPOINT,
          {
            template_id: resolvedTemplateId,
            sender: this.config.senderId,
            recipients: [{ mobiles: toE164(to), ...variables }],
          },
          {
            headers: {
              "Content-Type": "application/json",
              authkey: this.config.authKey,
            },
          }
        );
        return this.readResult(response.data, "send");
      } catch (error) {
        throw IntegrationError.from(
          { capability: CAPABILITY, provider: this.name, operation: "send" },
          error
        );
      }
    });
  }

  private readResult(data: unknown, operation: string): SendResult {
    const payload = data as { type?: string; message?: string } | undefined;
    const message = payload?.message ?? "";
    const succeeded =
      payload?.type === "success" || message.toLowerCase().includes("success");

    if (!succeeded) {
      throw new IntegrationError(message || "MSG91 request failed", {
        capability: CAPABILITY,
        provider: this.name,
        operation,
        retryable: false,
        raw: payload,
      });
    }

    return { providerMessageId: message || "unknown" };
  }
}
