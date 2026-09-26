import { IntegrationError } from "../../errors.js";
import {
  VendorExistsError,
  type CreateOrderInput,
  type GatewayOrder,
  type GatewayVendor,
  type PaymentGateway,
  type VendorInput,
  type VendorIssue,
  type VendorState,
} from "../provider.js";
import type { CashfreeClient } from "./client.js";
import {
  cashfreeOrderSchema,
  cashfreeVendorSchema,
  type CashfreeCreateOrderBody,
  type CashfreeVendorBody,
} from "./schemas.js";

/**
 * PaymentGateway, spoken as Cashfree PG.
 *
 * Maps GatePass's words to Cashfree's and back, and checks the answer: a
 * response is validated against its schema, and an order that comes back for
 * a different id or amount than we asked for is refused -- the payment row
 * would otherwise record one price while the driver is asked for another.
 */
export class CashfreeGateway implements PaymentGateway {
  readonly name = "cashfree" as const;

  constructor(
    private readonly client: CashfreeClient,
    readonly environment: "sandbox" | "production"
  ) {}

  async createOrder(input: CreateOrderInput): Promise<GatewayOrder> {
    const body: CashfreeCreateOrderBody = {
      order_id: input.orderId,
      // Cashfree takes a JSON number of rupees; `amount` is already exact to
      // the paisa, so this conversion cannot round.
      order_amount: Number(input.amount),
      order_currency: input.currency,
      customer_details: {
        customer_id: input.customer.id,
        customer_phone: input.customer.phone,
        ...(input.customer.email ? { customer_email: input.customer.email } : {}),
        ...(input.customer.name ? { customer_name: input.customer.name } : {}),
      },
      order_expiry_time: input.expiresAt.toISOString(),
      ...(input.tags ? { order_tags: input.tags } : {}),
    };

    const raw = await this.client.request({
      operation: "createOrder",
      method: "POST",
      path: "/orders",
      body,
      idempotencyKey: input.idempotencyKey,
    });

    const parsed = cashfreeOrderSchema.safeParse(raw);
    if (!parsed.success) {
      throw unexpected("createOrder", `response did not match the order schema (${parsed.error.issues.map((i) => i.path.join(".")).join(", ")})`);
    }

    const order = parsed.data;
    if (order.order_id !== input.orderId) {
      throw unexpected("createOrder", `asked for order ${input.orderId}, got ${order.order_id}`);
    }
    if (toPaise(order.order_amount) !== toPaise(body.order_amount)) {
      throw unexpected("createOrder", `asked for ${body.order_amount}, order is for ${order.order_amount}`);
    }

    return {
      provider: "cashfree",
      orderId: order.order_id,
      orderRef: order.cf_order_id,
      status: order.order_status,
      amount: order.order_amount.toFixed(2),
      sessionId: order.payment_session_id,
      expiresAt: new Date(order.order_expiry_time),
    };
  }

  async createVendor(input: VendorInput): Promise<GatewayVendor> {
    try {
      const raw = await this.client.request({
        operation: "createVendor",
        method: "POST",
        path: "/easy-split/vendors",
        body: { vendor_id: input.vendorId, ...vendorBody(input) },
        idempotencyKey: input.idempotencyKey,
      });
      return toVendor(raw, "createVendor", input.vendorId);
    } catch (error) {
      // The id is ours and stable per host, so "already exists" means an
      // earlier submission got through and its answer was lost.
      if (error instanceof IntegrationError && isDuplicate(error)) throw new VendorExistsError(input.vendorId);
      throw error;
    }
  }

  async updateVendor(input: VendorInput): Promise<GatewayVendor> {
    const raw = await this.client.request({
      operation: "updateVendor",
      method: "PATCH",
      path: `/easy-split/vendors/${encodeURIComponent(input.vendorId)}`,
      body: vendorBody(input),
      idempotencyKey: input.idempotencyKey,
    });
    return toVendor(raw, "updateVendor", input.vendorId);
  }

  async getVendor(vendorId: string): Promise<GatewayVendor> {
    const raw = await this.client.request({
      operation: "getVendor",
      method: "GET",
      path: `/easy-split/vendors/${encodeURIComponent(vendorId)}`,
    });
    return toVendor(raw, "getVendor", vendorId);
  }
}

function isDuplicate(error: IntegrationError): boolean {
  return error.statusCode === 409 || (error.statusCode === 400 && /already exist/i.test(error.message));
}

/**
 * Cashfree's vendor statuses, in GatePass's three.
 *
 * Anything not listed -- a status Cashfree adds later -- reads as PENDING:
 * it holds the host at "being checked" (the listing stays offline) rather
 * than letting an unknown word open the publication gate or tell a host
 * they did something wrong.
 */
const VENDOR_STATES: Record<string, { state: VendorState; issue?: VendorIssue }> = {
  ACTIVE: { state: "ACTIVE" },
  IN_BANK_VALIDATION: { state: "PENDING" },
  IN_BENE_CREATION: { state: "PENDING" },
  ON_HOLD: { state: "PENDING" },
  BANK_VALIDATION_FAILED: { state: "FAILED", issue: "BANK_ACCOUNT" },
  BENE_CREATION_FAILED: { state: "FAILED", issue: "BANK_ACCOUNT" },
  ACTION_REQUIRED: { state: "FAILED", issue: "KYC" },
  BLOCKED: { state: "FAILED", issue: "BLOCKED" },
  DELETED: { state: "FAILED", issue: "BLOCKED" },
};

function toVendor(raw: unknown, operation: string, expectedId: string): GatewayVendor {
  const parsed = cashfreeVendorSchema.safeParse(raw);
  if (!parsed.success) {
    throw unexpected(operation, `response did not match the vendor schema (${parsed.error.issues.map((i) => i.path.join(".")).join(", ")})`);
  }
  if (parsed.data.vendor_id !== expectedId) {
    throw unexpected(operation, `asked for vendor ${expectedId}, got ${parsed.data.vendor_id}`);
  }

  const status = parsed.data.status.toUpperCase();
  return { vendorId: parsed.data.vendor_id, providerStatus: status, ...(VENDOR_STATES[status] ?? { state: "PENDING" }) };
}

/** Cashfree allows letters, digits, spaces and . / - & in a vendor name. */
const vendorName = (name: string) => name.replace(/[^A-Za-z0-9 ./&-]/g, "").replace(/\s+/g, " ").trim();

function vendorBody(input: VendorInput): CashfreeVendorBody {
  return {
    status: "ACTIVE",
    name: vendorName(input.name),
    email: input.email,
    phone: input.phone,
    // Penny-drop plus a name match: Cashfree checks the account is real and
    // the holder's name matches before any money is routed to it.
    verify_account: true,
    // Hosts see their earnings in GatePass, not in Cashfree's dashboard.
    dashboard_access: false,
    bank: {
      account_number: input.bank.accountNumber,
      account_holder: input.bank.accountHolder,
      ifsc: input.bank.ifsc,
    },
    kyc_details: {
      account_type: input.kyc.accountType,
      ...(input.kyc.accountType === "BUSINESS" && input.kyc.businessType ? { business_type: input.kyc.businessType } : {}),
      pan: input.kyc.pan,
    },
  };
}

const toPaise = (rupees: number) => Math.round(rupees * 100);

/** Cashfree answered, but not with what was asked: not worth a retry. */
function unexpected(operation: string, message: string): IntegrationError {
  return new IntegrationError(`Unexpected Cashfree response: ${message}`, {
    capability: "payment",
    provider: "cashfree",
    operation,
    retryable: false,
  });
}
