import type { SendResult } from "../types.js";

export interface SendLoginCodeInput {
  to: string;
  code: string;
}

/**
 * How long a send may take, and how hard to try.
 *
 * Separate from the integration-wide defaults because a login code is sent
 * while someone waits on a button. The generic policy -- ten seconds, three
 * attempts -- is right for a background job and wrong here: half a minute of
 * spinner is worse than being told to try again.
 */
export interface SendOptions {
  timeoutMs?: number;
  retries?: number;
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
  send(input: SendEmailInput, options?: SendOptions): Promise<SendResult>;
}
