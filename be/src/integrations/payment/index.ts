import { env } from "../../config/env.js";
import { CASHFREE_BASE_URLS, CashfreeClient } from "./cashfree/client.js";
import { CashfreeGateway } from "./cashfree/gateway.js";
import type { PaymentGateway } from "./provider.js";

let cached: PaymentGateway | null | undefined;

/**
 * The configured gateway, or null when PAYMENT_PROVIDER=none.
 *
 * Null rather than a 503, unlike place search: "no gateway" is a working mode
 * -- bookings are placed as holds with nothing to pay yet -- not a feature
 * that is down.
 */
export function getPaymentGateway(): PaymentGateway | null {
  if (cached !== undefined) return cached;

  switch (env.PAYMENT_PROVIDER) {
    case "cashfree":
      cached = new CashfreeGateway(
        new CashfreeClient({
          // Both checked at boot (config/env) when the provider is cashfree.
          clientId: env.CASHFREE_CLIENT_ID!,
          clientSecret: env.CASHFREE_CLIENT_SECRET!,
          apiVersion: env.CASHFREE_API_VERSION,
          baseUrl: CASHFREE_BASE_URLS[env.CASHFREE_ENV],
          timeoutMs: env.INTEGRATION_TIMEOUT_MS,
          maxRetries: env.INTEGRATION_MAX_RETRIES,
        }),
        env.CASHFREE_ENV
      );
      break;
    default:
      cached = null;
  }

  return cached;
}

export { VendorExistsError } from "./provider.js";
export type {
  CreateOrderInput,
  GatewayOrder,
  GatewayOrderStatus,
  GatewayVendor,
  PaymentGateway,
  VendorInput,
  VendorIssue,
  VendorState,
} from "./provider.js";
