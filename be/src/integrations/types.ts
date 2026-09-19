export type IntegrationCapability =
  | "email"
  | "whatsapp"
  | "payment"
  | "push"
  | "geocode";

export interface SendResult {
  providerMessageId: string;
}
