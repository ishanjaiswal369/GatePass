import type { PayoutAccount } from "@/types/api.types";

/**
 * Where a host's payout account stands, in the four states every screen
 * shows it in -- the Payouts screen, the Host tab card, a listing's status
 * and the review step all read it from here, so they can't disagree.
 */
export type PayoutAccountState = "ready" | "pending" | "failed" | "none";

/** The route of the Payouts screen: the one place the account is set up or fixed. */
export const PAYOUTS_PATH = "/payouts";

export function payoutAccountState(account: PayoutAccount | null | undefined): PayoutAccountState {
  if (!account) return "none";
  if (account.payoutKycStatus === "ACTIVATED") return "ready";
  if (account.payoutKycStatus === "REJECTED") return "failed";
  // The API decides, not the status: an account submitted before the details
  // were stored reads as UNDER_REVIEW with nothing behind it, and showing that
  // host a read-only "pending" would strand them away from the form that fixes it.
  if (account.needsDetails || account.payoutKycStatus === "NOT_STARTED") return "none";
  return "pending";
}

export const PAYOUT_STATE_COPY: Record<PayoutAccountState, { title: string; body: string }> = {
  ready: { title: "Ready to be paid", body: "Your payout account is active." },
  pending: { title: "Verification pending", body: "Your payout details are being verified. This usually takes a day or two." },
  failed: { title: "Verification failed", body: "Your payout details need attention." },
  none: { title: "Add your payout account", body: "Add your bank account to get your earnings. Your spaces go live only once it is active." },
};

/** Why verification failed, in words a host can act on. */
export const PAYOUT_ISSUE_COPY: Record<NonNullable<PayoutAccount["issue"]>, string> = {
  BANK_ACCOUNT:
    "Your bank account couldn't be verified. Check the account number, the IFSC, and the name exactly as your bank has it.",
  KYC: "Your PAN couldn't be verified. Check it's typed correctly and belongs to the account holder.",
  BLOCKED: "Your payout account is blocked. Contact support to reopen it.",
};

/** What stands between an approved listing and going live, for its one-line status. */
export function payoutWaitLine(account: PayoutAccount | null | undefined): string {
  switch (payoutAccountState(account)) {
    case "none":
      return "Approved — add your payout account to go live";
    case "failed":
      return "Approved — fix your payout account to go live";
    case "pending":
      return "Approved — goes live once your payout account is verified";
    default:
      return "Approved — going live";
  }
}
