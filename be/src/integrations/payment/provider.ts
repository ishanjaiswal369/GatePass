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
