/**
 * What GatePass needs from a payment gateway, in GatePass's own words.
 *
 * Services import this and nothing under a gateway's folder, so the wire
 * format -- Cashfree's snake_case, its statuses, its headers -- never leaks
 * past the adapter, and a second gateway (or a fake in a test) is one new
 * implementation of this interface.
 */

export type PaymentProviderName = "cashfree";

/** Where an order stands at the gateway. */
export type GatewayOrderStatus =
  /** Open: no successful payment yet. */
  | "ACTIVE"
  /** One successful payment against it. */
  | "PAID"
  /** Unpaid, and past its expiry: no payment can start. */
  | "EXPIRED"
  | "TERMINATED"
  | "TERMINATION_REQUESTED";

export interface CreateOrderInput {
  /** Our id for the order, unique per order: 3-45 of [A-Za-z0-9_-]. */
  orderId: string;
  /** Rupees with at most two decimals, at least ₹1. */
  amount: string;
  currency: "INR";
  customer: {
    /** Stable per user, alphanumeric, 3-50. */
    id: string;
    /** 10 digits (Indian mobile, without +91). */
    phone: string;
    email?: string;
    name?: string;
  };
  /** When the gateway must stop taking payment for it. */
  expiresAt: Date;
  /** Ids only -- the gateway's dashboard shows them, so never personal data. */
  tags?: Record<string, string>;
  /**
   * Where the gateway's own payment pages (card 3-D Secure) send the driver
   * when they finish. `{order_id}` is filled in by the gateway.
   */
  returnUrl?: string;
  /** Where the gateway posts this order's payment webhooks. */
  notifyUrl?: string;
  /**
   * Who is paid what out of this order (Easy Split): the gateway settles each
   * payee's part to them by itself once the payment is in. Rupees, exact to
   * the paisa; whatever isn't split out stays with GatePass.
   */
  splits?: { vendorId: string; amount: string }[];
  /**
   * Same key, same order: a retry after a timeout returns the order the first
   * attempt made instead of making another. A UUID, stable across retries.
   */
  idempotencyKey: string;
}

export interface GatewayOrder {
  provider: PaymentProviderName;
  /** Our id, as sent. */
  orderId: string;
  /** The gateway's own id for it. */
  orderRef: string;
  status: GatewayOrderStatus;
  /** Rupees, as the gateway recorded them. */
  amount: string;
  /** What the app's checkout opens. */
  sessionId: string;
  expiresAt: Date;
}

/**
 * The device the driver pays from. Gateways shape UPI around it: an intent
 * only opens on a phone, and Cashfree refuses UPI collect on Android and
 * desktop.
 */
export interface ClientHints {
  device: "mobile" | "desktop" | "tablet";
  os: "android" | "ios" | "windows" | "macos" | "linux" | "others";
  rendering?: "native" | "mweb" | "webview";
  browser: "chrome" | "safari" | "firefox" | "edge" | "others";
}

/** The UPI apps a payment can be opened in; `default` is the phone's own chooser. */
export const UPI_APPS = ["default", "gpay", "phonepe", "paytm", "bhim"] as const;
export type UpiApp = (typeof UPI_APPS)[number];

export interface StartUpiInput {
  /** The order's checkout session, from createOrder. */
  sessionId: string;
  /** INTENT: open a UPI app on this phone. QR: a code to scan from another. */
  channel: "INTENT" | "QR";
  client: ClientHints;
}

/** One UPI attempt against an order. An order takes any number of them. */
export type UpiAttempt =
  | { paymentRef: string; channel: "INTENT"; apps: Partial<Record<UpiApp, string>> }
  | { paymentRef: string; channel: "QR"; qrImage: string };

/**
 * Where one payment attempt on an order stands. Only SUCCESS is money in;
 * anything the gateway adds later reads as UNKNOWN, never as paid.
 */
export type GatewayPaymentStatus =
  | "SUCCESS"
  | "PENDING"
  | "FAILED"
  | "NOT_ATTEMPTED"
  | "USER_DROPPED"
  | "VOID"
  | "CANCELLED"
  | "UNKNOWN";

export interface GatewayPayment {
  /** The gateway's id for the attempt (Cashfree `cf_payment_id`). */
  paymentRef: string;
  /** Our order id, as the gateway recorded it. */
  orderId: string;
  status: GatewayPaymentStatus;
  /** Rupees, exact to the paisa. */
  amount: string;
  currency: string;
  /** "upi", "debit_card"... for support and logs. */
  method: string | null;
  completedAt: Date | null;
}

/** Where one transfer of a host's money to their bank stands. */
export type GatewaySettlementStatus = "INITIATED" | "SUCCESS" | "FAILED" | "REVERSED";

/** One transfer of a payee's balance to their bank (Easy Split vendor settlement). */
export interface GatewaySettlement {
  /** The gateway's settlement id. */
  id: string;
  vendorId: string;
  status: GatewaySettlementStatus;
  /** Rupees, exact to the paisa. */
  amount: string;
  utr: string | null;
  /** Why it failed or came back, in the gateway's words (a code such as INVALID_IFSC_FAIL, or text). */
  reason: string | null;
  periodFrom: Date | null;
  periodTill: Date | null;
  initiatedAt: Date | null;
  settledAt: Date | null;
}

/**
 * Money back to the payer, on the order it was paid against.
 */
export interface CreateRefundInput {
  /** The order the payment was made on. */
  orderId: string;
  /** Our id for this refund: 3-40 letters and digits, unique per order. */
  refundId: string;
  /** Rupees with at most two decimals, no more than was paid. */
  amount: string;
  /** For the gateway's dashboard and the payer's statement: ids and rules only. */
  note: string;
  /**
   * Who bears what of it (Easy Split): each payee's balance is debited this
   * much, the rest comes out of GatePass's share. Rupees, exact to the paisa.
   */
  splits?: { vendorId: string; amount: string }[];
  /** A UUID, the same on every retry of this refund. */
  idempotencyKey: string;
}

/**
 * Where a refund stands, in GatePass's words:
 * - PENDING: accepted, on its way (the gateway's PENDING, ONHOLD, PENDING_APPROVAL).
 * - SUCCESS: the money has gone back.
 * - FAILED: it won't -- cancelled or rejected by the gateway.
 * Anything the gateway adds later reads as PENDING: never as money returned.
 */
export type GatewayRefundStatus = "PENDING" | "SUCCESS" | "FAILED";

export interface GatewayRefund {
  /** Our id, as sent. */
  refundId: string;
  /** The gateway's own id for it (Cashfree cf_refund_id). */
  refundRef: string;
  orderId: string;
  status: GatewayRefundStatus;
  /** The gateway's own status word, kept for support and logs. */
  providerStatus: string;
  /** Rupees, exact to the paisa. */
  amount: string;
  /** The bank's reference (ARN), once it has one. */
  bankReference: string | null;
  /** The gateway's description of the status, when it gives one. */
  description: string | null;
  processedAt: Date | null;
}

/** createRefund with a refund id the gateway already has: read that one instead. */
export class RefundExistsError extends Error {
  constructor(readonly orderId: string, readonly refundId: string) {
    super(`Refund ${refundId} already exists on order ${orderId}`);
    this.name = "RefundExistsError";
  }
}

/**
 * A webhook the gateway sent, once its signature has checked out -- reduced
 * to what GatePass acts on. For a payment or a vendor it is only which one:
 * what happened is then asked of the gateway, so nothing in the body is
 * trusted for money or status. A settlement has no call to ask, so the
 * signed body is the record.
 */
export type GatewayNotice =
  | { kind: "PAYMENT"; type: string; orderId: string }
  | { kind: "VENDOR_STATUS"; type: string; vendorId: string }
  | { kind: "VENDOR_SETTLEMENT"; type: string; settlement: GatewaySettlement }
  /** A refund moved: which one. Its state is then asked of the gateway. */
  | { kind: "REFUND"; type: string; orderId: string; refundId: string }
  /** Signed, but nothing GatePass handles (or a body it can't read). */
  | { kind: "OTHER"; type: string };

/**
 * A host as the gateway's payee (Cashfree Easy Split vendor): who they are,
 * where their share of a payment goes, and their KYC.
 */
export interface VendorInput {
  /** Our id for the vendor, stable per host: [A-Za-z0-9_]. */
  vendorId: string;
  name: string;
  email: string;
  /** 10 digits (Indian mobile, without +91). */
  phone: string;
  bank: { accountNumber: string; accountHolder: string; ifsc: string };
  /** businessType for a BUSINESS account only. */
  kyc: { accountType: "INDIVIDUAL" | "BUSINESS"; businessType?: string; pan: string };
  /** A UUID; the same on every retry of one submission. */
  idempotencyKey: string;
}

/**
 * Where a vendor stands, in GatePass's terms:
 * - ACTIVE: money can reach them.
 * - PENDING: the gateway is still checking (bank validation, beneficiary set-up, a manual hold).
 * - FAILED: something the host has to fix -- `issue` says what.
 */
export type VendorState = "ACTIVE" | "PENDING" | "FAILED";

export type VendorIssue =
  /** The bank account didn't validate, or the gateway couldn't add it as a payee. */
  | "BANK_ACCOUNT"
  /** A KYC detail (PAN) failed verification. */
  | "KYC"
  /** Blocked or deleted at the gateway: only support can undo it. */
  | "BLOCKED";

export interface GatewayVendor {
  vendorId: string;
  state: VendorState;
  issue?: VendorIssue;
  /** The gateway's own status string, kept for support and logs. */
  providerStatus: string;
}

export interface PaymentGateway {
  readonly name: PaymentProviderName;
  /** Which of the gateway's environments this talks to, for the app's SDK. */
  readonly environment: "sandbox" | "production";

  createOrder(input: CreateOrderInput): Promise<GatewayOrder>;

  /**
   * Starts a UPI payment on an open order: links to a UPI app, or a QR.
   * Only links the app may safely open come back.
   */
  startUpiPayment(input: StartUpiInput): Promise<UpiAttempt>;

  /** Every payment attempt on an order, as the gateway sees it now. */
  getOrderPayments(orderId: string): Promise<GatewayPayment[]>;

  /**
   * Sends money back on a paid order. Throws RefundExistsError when the
   * refund id was already used on it -- an earlier send got through.
   */
  createRefund(input: CreateRefundInput): Promise<GatewayRefund>;
  /** One refund, as the gateway sees it now. */
  getRefund(orderId: string, refundId: string): Promise<GatewayRefund>;

  /**
   * A webhook, if it is genuinely the gateway's: null when the signature
   * doesn't verify against the raw body exactly as received.
   */
  readWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): GatewayNotice | null;

  /** Registers a host as a payee. Throws VendorExistsError if the id is taken. */
  createVendor(input: VendorInput): Promise<GatewayVendor>;
  /** Replaces a payee's details -- a host fixing a rejected account. */
  updateVendor(input: VendorInput): Promise<GatewayVendor>;
  getVendor(vendorId: string): Promise<GatewayVendor>;
}

/** createVendor on an id the gateway already has: the caller updates instead. */
export class VendorExistsError extends Error {
  constructor(readonly vendorId: string) {
    super(`Vendor ${vendorId} already exists`);
    this.name = "VendorExistsError";
  }
}
