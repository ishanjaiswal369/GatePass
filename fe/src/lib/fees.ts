/**
 * What GatePass's cut is called wherever a host sees it. One source of
 * revenue: a share of each booking's parking amount, taken from the host's
 * side (COMMISSION_RATE on the API). The driver pays the listed price and
 * never sees it.
 */
export const SERVICE_FEE_LABEL = "Service fee";

/** "Service fee (10%)" */
export function serviceFeeLabel(rate: number): string {
  return `${SERVICE_FEE_LABEL} (${Math.round(rate * 100)}%)`;
}
