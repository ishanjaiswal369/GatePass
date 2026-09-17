export type IntegrationCapability =
  | "email"
  | "whatsapp"
  | "payment"
  | "push";

export interface SendResult {
  providerMessageId: string;
}
