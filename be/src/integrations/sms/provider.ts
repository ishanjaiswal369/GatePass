import type { SendResult } from "../types.js";

export interface SendOtpInput {
  to: string;
  otp: string;
}

export interface SendSmsInput {
  to: string;
  templateId?: string;
  variables: Record<string, string>;
}

export interface SmsProvider {
  readonly name: "msg91" | "console";
  sendOtp(input: SendOtpInput): Promise<SendResult>;
  send(input: SendSmsInput): Promise<SendResult>;
}
