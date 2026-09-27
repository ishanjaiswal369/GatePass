import { getPaymentGateway } from "../integrations/payment/index.js";
import { audit } from "../lib/security-log.js";
import * as hostPayoutLedger from "./host-payout-ledger.service.js";
import * as hostPayoutService from "./host-payout.service.js";
import * as paymentConfirmation from "./payment-confirmation.service.js";

export type WebhookOutcome = "HANDLED" | "IGNORED" | "BAD_SIGNATURE";

/**
 * Every webhook the payment gateway sends (POST /webhooks/cashfree): a
 * payment on one of our orders (each order's notify_url), and -- from URLs
 * set in the gateway's dashboard -- a change to a host's payee status or a
 * transfer of a host's money to their bank.
 *
 * The signature is checked against the raw body before anything is read from
 * it. Throws when a handler can't finish (usually the gateway can't be asked
 * back): the route answers 5xx and the gateway sends it again later (Cashfree
 * retries at 2, 10 and 30 minutes). Everything a handler writes is
 * conditional on the state it moves from, so a retry or a duplicate changes
 * nothing more than the first delivery did.
 */
export async function receiveGatewayWebhook(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  now = new Date()
): Promise<WebhookOutcome> {
  const gateway = getPaymentGateway();
  if (!gateway) return "IGNORED";

  const notice = gateway.readWebhook(rawBody, headers);
  if (!notice) return "BAD_SIGNATURE";

  switch (notice.kind) {
    case "PAYMENT":
      return paymentConfirmation.onOrderNotice(notice.orderId, notice.type, now);
    case "VENDOR_STATUS":
      return hostPayoutService.onVendorNotice(notice.vendorId);
    case "VENDOR_SETTLEMENT":
      return hostPayoutLedger.recordSettlement(notice.settlement);
    default:
      // Refunds, disputes... not handled yet. Acknowledged so it isn't resent.
      audit("GATEWAY_WEBHOOK_IGNORED", { provider: gateway.name, type: notice.type });
      return "IGNORED";
  }
}
