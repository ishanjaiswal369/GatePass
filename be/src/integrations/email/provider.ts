import type { SendResult } from "../types.js";

export interface SendLoginCodeInput {
  to: string;
  code: string;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailProvider {
  readonly name: "resend" | "console";
  sendLoginCode(input: SendLoginCodeInput): Promise<SendResult>;
  send(input: SendEmailInput): Promise<SendResult>;
}
