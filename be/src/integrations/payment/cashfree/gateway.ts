import { createHmac, timingSafeEqual } from "node:crypto";
import { IntegrationError } from "../../errors.js";
import {
  UPI_APPS,
  VendorExistsError,
  type CreateOrderInput,
  type GatewayOrder,
  type GatewayNotice,
  type GatewayPayment,
  type GatewayPaymentStatus,
  type GatewayVendor,
  type PaymentGateway,
  type StartUpiInput,
  type UpiApp,
  type UpiAttempt,
  type VendorInput,
  type VendorIssue,
  type VendorState,
} from "../provider.js";
import type { CashfreeClient } from "./client.js";
import {
  cashfreeOrderSchema,
  cashfreePaymentListSchema,
  cashfreeUpiPaySchema,
  cashfreeWebhookSchema,
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
    readonly environment: "sandbox" | "production",
    /** The client secret: Cashfree signs webhooks with it. */
    private readonly webhookSecret: string
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
      ...(input.returnUrl || input.notifyUrl
        ? {
            order_meta: {
              ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
              ...(input.notifyUrl ? { notify_url: input.notifyUrl } : {}),
            },
          }
        : {}),
      ...(input.splits?.length
        ? { order_splits: input.splits.map((split) => ({ vendor_id: split.vendorId, amount: Number(split.amount) })) }
        : {}),
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
    // The split is money leaving for someone else: the order must carry
    // exactly the one asked for, or it isn't used.
    if (!sameSplits(body.order_splits ?? [], order.order_splits ?? [])) {
      throw unexpected("createOrder", "the order's split is not the one asked for");
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

  async startUpiPayment(input: StartUpiInput): Promise<UpiAttempt> {
    const channel = input.channel === "QR" ? "qrcode" : "link";

    // Order Pay is authorised by the session id; the auth headers the client
    // adds anyway are harmless. No idempotency key, so never retried: an
    // attempt whose answer was lost is just an attempt nobody pays.
    const raw = await this.client.request({
      operation: "startUpiPayment",
      method: "POST",
      path: "/orders/sessions",
      body: { payment_session_id: input.sessionId, payment_method: { upi: { channel } } },
      headers: {
        "x-client-device": input.client.device,
        "x-client-os": input.client.os,
        "x-client-browser": input.client.browser,
        ...(input.client.rendering ? { "x-client-rendering-type": input.client.rendering } : {}),
      },
    });

    const parsed = cashfreeUpiPaySchema.safeParse(raw);
    if (!parsed.success) {
      throw unexpected("startUpiPayment", `response did not match the UPI schema (${parsed.error.issues.map((i) => i.path.join(".")).join(", ")})`);
    }
    if (parsed.data.channel !== channel) {
      throw unexpected("startUpiPayment", `asked for ${channel}, got ${parsed.data.channel}`);
    }

    const payload = parsed.data.data.payload ?? {};
    const paymentRef = parsed.data.cf_payment_id;

    if (channel === "qrcode") {
      const image = payload.qrcode;
      if (typeof image !== "string" || !QR_IMAGE.test(image) || image.length > MAX_QR_CHARS) {
        throw unexpected("startUpiPayment", "no usable QR image in the response");
      }
      return { paymentRef, channel: "QR", qrImage: image };
    }

    const apps: Partial<Record<UpiApp, string>> = {};
    for (const app of UPI_APPS) {
      const link = payload[app];
      if (typeof link === "string" && isSafeUpiLink(link)) apps[app] = link;
    }
    if (Object.keys(apps).length === 0) {
      throw unexpected("startUpiPayment", "no UPI app link the app may open");
    }
    return { paymentRef, channel: "INTENT", apps };
  }

  async getOrderPayments(orderId: string): Promise<GatewayPayment[]> {
    const raw = await this.client.request({
      operation: "getOrderPayments",
      method: "GET",
      path: `/orders/${encodeURIComponent(orderId)}/payments`,
    });

    const parsed = cashfreePaymentListSchema.safeParse(raw);
    if (!parsed.success) {
      throw unexpected("getOrderPayments", `response did not match the payment schema (${parsed.error.issues.map((i) => i.path.join(".")).join(", ")})`);
    }

    return parsed.data.map((payment) => {
      if (payment.order_id !== orderId) {
        throw unexpected("getOrderPayments", `asked for order ${orderId}, got a payment of ${payment.order_id}`);
      }
      const status = payment.payment_status.toUpperCase();
      const completed = payment.payment_completion_time ? new Date(payment.payment_completion_time) : null;
      return {
        paymentRef: payment.cf_payment_id,
        orderId: payment.order_id,
        status: (PAYMENT_STATUSES as readonly string[]).includes(status) ? (status as GatewayPaymentStatus) : "UNKNOWN",
        amount: payment.payment_amount.toFixed(2),
        currency: payment.payment_currency,
        method: payment.payment_group ?? null,
        completedAt: completed && !Number.isNaN(completed.getTime()) ? completed : null,
      };
    });
  }

  readWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): GatewayNotice | null {
    const header = (name: string) => {
      const value = headers[name];
      return Array.isArray(value) ? value[0] : value;
    };
    const signature = header("x-webhook-signature");
    const timestamp = header("x-webhook-timestamp");
    if (!signature || !timestamp) return null;

    // Base64(HMAC-SHA256(timestamp + raw body, client secret)), per
    // Cashfree's webhook docs -- over the bytes as sent, never a re-serialised
    // copy, which would differ in spacing and key order.
    const expected = createHmac("sha256", this.webhookSecret).update(timestamp + rawBody).digest();
    let given: Buffer;
    try {
      given = Buffer.from(signature, "base64");
    } catch {
      return null;
    }
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return null;
    }
    const parsed = cashfreeWebhookSchema.safeParse(body);
    if (!parsed.success) return { type: "UNKNOWN", orderId: null };
    return { type: parsed.data.type, orderId: parsed.data.data?.order?.order_id ?? null };
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
      // A business account only (owner's decision, 2026-09-26). Note: the
      // sandbox keys in use on that date refused an individual without it
      // (business_type_missing); that refusal reaches the host as a 422.
      ...(input.kyc.accountType === "BUSINESS" && input.kyc.businessType ? { business_type: input.kyc.businessType } : {}),
      pan: input.kyc.pan,
    },
  };
}

const toPaise = (rupees: number) => Math.round(rupees * 100);

function sameSplits(sent: { vendor_id: string; amount: number }[], got: { vendor_id: string; amount?: number | null }[]): boolean {
  if (sent.length !== got.length) return false;
  return sent.every((split) =>
    got.some((echo) => echo.vendor_id === split.vendor_id && typeof echo.amount === "number" && toPaise(echo.amount) === toPaise(split.amount))
  );
}

/** Cashfree's payment statuses that GatePass names; anything else is UNKNOWN. */
const PAYMENT_STATUSES = ["SUCCESS", "PENDING", "FAILED", "NOT_ATTEMPTED", "USER_DROPPED", "VOID", "CANCELLED"] as const;

/**
 * What a UPI link may be before the app opens it: a UPI app's own scheme
 * (production), or a page on Cashfree's domain (the sandbox's simulator).
 * Anything else -- javascript:, a lookalike host, plain http -- is dropped,
 * so a bad or tampered answer can't send a driver somewhere else to "pay".
 */
const UPI_SCHEMES = new Set(["upi:", "tez:", "gpay:", "phonepe:", "paytmmp:", "paytm:", "bhim:"]);

function isSafeUpiLink(link: string): boolean {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return false;
  }
  if (UPI_SCHEMES.has(url.protocol)) return true;
  return url.protocol === "https:" && (url.hostname === "cashfree.com" || url.hostname.endsWith(".cashfree.com"));
}

/** Cashfree sends the QR as a PNG data URL; ~10 KB in practice. */
const QR_IMAGE = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_QR_CHARS = 512 * 1024;

/** Cashfree answered, but not with what was asked: not worth a retry. */
function unexpected(operation: string, message: string): IntegrationError {
  return new IntegrationError(`Unexpected Cashfree response: ${message}`, {
    capability: "payment",
    provider: "cashfree",
    operation,
    retryable: false,
  });
}
