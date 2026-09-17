export const SETTLEMENT_STATUSES = [
  "PENDING",
  "PROCESSING",
  "PAID",
  "DISPUTED",
] as const;

export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export const DEFAULT_SETTLEMENT_STATUS: SettlementStatus = "PENDING";
