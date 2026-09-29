import type { PushMessage, PushProvider, PushResult } from "./provider.js";

export class ConsolePushProvider implements PushProvider {
  readonly name = "console" as const;

  async send({ token, title }: PushMessage): Promise<PushResult> {
    console.log(`[push:console] "${title}" to …${token.slice(-8)} (not sent)`);
    return { ok: true, providerMessageId: `console-${Date.now()}` };
  }
}
