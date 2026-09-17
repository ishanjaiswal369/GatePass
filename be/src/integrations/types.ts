export type IntegrationCapability =
  | "sms"
  | "email"
  | "whatsapp"
  | "payment"
  | "push";

export interface SendResult {
  providerMessageId: string;
}
