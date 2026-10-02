import { z } from "zod";

/**
 * Cashfree's responses, checked before anything reads them.
 *
 * Only the fields GatePass uses are required; the rest pass through untouched,
 * so a field Cashfree adds in a later API version doesn't break parsing. A
 * response missing one we need fails loudly here rather than as an undefined
 * written to a payment row.
 */

export const CASHFREE_ORDER_STATUSES = [
  "ACTIVE",
  "PAID",
  "EXPIRED",
  "TERMINATED",
  "TERMINATION_REQUESTED",
] as const;

/** POST /orders (and later GET /orders/:id). */
export const cashfreeOrderSchema = z
  .object({
    cf_order_id: z.union([z.string(), z.number()]).transform(String),
    order_id: z.string().min(1),
    order_status: z.enum(CASHFREE_ORDER_STATUSES),
    order_amount: z.number(),
    order_currency: z.string(),
    payment_session_id: z.string().min(1),
    order_expiry_time: z.string().datetime({ offset: true }),
    order_splits: z
      .array(z.object({ vendor_id: z.string(), amount: z.number().nullish() }).passthrough())
      .nullish(),
  })
  .passthrough();

export type CashfreeOrder = z.infer<typeof cashfreeOrderSchema>;

/**
 * POST /orders/sessions (Order Pay) for UPI. `action` is "custom" for both
 * channels; the links (link) or the QR image (qrcode) are in data.payload.
 * Each payload value is checked again in gateway.ts before it goes anywhere.
 */
export const cashfreeUpiPaySchema = z
  .object({
    cf_payment_id: z.union([z.string(), z.number()]).transform(String),
    payment_method: z.literal("upi"),
    channel: z.enum(["link", "qrcode"]),
    data: z
      .object({
        payload: z.record(z.string(), z.unknown()).nullable(),
      })
      .passthrough(),
  })
  .passthrough();

/**
 * One entry of GET /orders/{order_id}/payments. The amount is read from
 * `payment_amount` (what was charged), never `order_amount`. The id comes as
 * a string -- 19 digits, past what a JS number holds exactly -- so a number
 * is refused rather than rounded into some other payment's id.
 */
export const cashfreePaymentSchema = z
  .object({
    cf_payment_id: z.string().min(1),
    order_id: z.string().min(1),
    payment_status: z.string().min(1),
    payment_amount: z.number(),
    payment_currency: z.string(),
    payment_group: z.string().nullish(),
    payment_completion_time: z.string().nullish(),
  })
  .passthrough();

export const cashfreePaymentListSchema = z.array(cashfreePaymentSchema);

/**
 * A refund (POST /orders/{id}/refunds, GET /orders/{id}/refunds/{refund_id}).
 * The docs show the create answer both as the entity and as a one-entry
 * list; gateway.ts takes either. `cf_refund_id` is kept as a string -- an id
 * past what a JS number holds exactly would otherwise be rounded.
 */
export const cashfreeRefundSchema = z
  .object({
    cf_refund_id: z.union([z.string().min(1), z.number()]).transform(String),
    refund_id: z.string().min(1),
    order_id: z.string().min(1),
    refund_amount: z.number(),
    refund_status: z.string().min(1),
    refund_arn: z.union([z.string(), z.number()]).nullish(),
    status_description: z.string().nullish(),
    processed_at: z.string().nullish(),
  })
  .passthrough();

/** The body of POST /orders/{order_id}/refunds. */
export interface CashfreeCreateRefundBody {
  refund_amount: number;
  refund_id: string;
  refund_note: string;
  refund_speed: "STANDARD";
  refund_splits?: { vendor_id: string; amount: number }[];
}

/**
 * REFUND_STATUS_WEBHOOK's data. Only the two ids are read; the status comes
 * from Get Refund, so nothing in the body decides what GatePass records.
 */
export const cashfreeRefundWebhookSchema = z
  .object({ refund: z.object({ order_id: z.string().min(1), refund_id: z.string().min(1) }).passthrough() })
  .passthrough();

/** Every Cashfree webhook: an event name and its data. */
export const cashfreeWebhookSchema = z
  .object({ type: z.string().min(1), data: z.record(z.string(), z.unknown()).nullish() })
  .passthrough();

/**
 * A payment webhook's data (PAYMENT_SUCCESS_WEBHOOK and friends). Only the
 * order id is read; the rest -- amounts, the payment id, whose 19 digits a
 * JSON number can't hold -- comes from Get Payments.
 */
export const cashfreePaymentWebhookSchema = z
  .object({ order: z.object({ order_id: z.string().min(1) }).passthrough() })
  .passthrough();

/**
 * VENDOR_STATUS_UPDATE's data. Only the vendor id is read: the body also
 * carries the vendor's bank account, phone and email, none of which GatePass
 * needs from here, and the status is asked of Get Vendor.
 */
export const cashfreeVendorStatusWebhookSchema = z
  .object({ merchant_vendor_id: z.string().min(1) })
  .passthrough();

/**
 * VENDOR_SETTLEMENT_*'s data. Cashfree's own examples write a missing value
 * as the string "null", so strings are read through `present` in gateway.ts.
 */
export const cashfreeSettlementWebhookSchema = z
  .object({
    settlement: z
      .object({
        settlement_id: z.union([z.number(), z.string().min(1)]),
        vendor_id: z.string().min(1),
        status: z.string().nullish(),
        utr: z.union([z.string(), z.number()]).nullish(),
        reason: z.string().nullish(),
        settlement_amount: z.number().nullish(),
        amount_settled: z.number().nullish(),
        vendor_transaction_amount: z.number().nullish(),
        payment_from: z.string().nullish(),
        payment_till: z.string().nullish(),
        settlement_initiated_on: z.string().nullish(),
        settled_on: z.string().nullish(),
      })
      .passthrough(),
  })
  .passthrough();

/**
 * Easy Split vendor (POST/PATCH/GET /easy-split/vendors). Only the id and
 * status are read; a status string Cashfree adds later still parses, and maps
 * to "pending" rather than failing (gateway.ts).
 */
export const cashfreeVendorSchema = z
  .object({
    vendor_id: z.string().min(1),
    status: z.string().min(1),
  })
  .passthrough();

/** The body of POST /easy-split/vendors (PATCH takes the same, without vendor_id). */
export interface CashfreeVendorBody {
  vendor_id?: string;
  status: "ACTIVE";
  name: string;
  email: string;
  phone: string;
  verify_account: boolean;
  dashboard_access: boolean;
  bank: { account_number: string; account_holder: string; ifsc: string };
  kyc_details: { account_type: "INDIVIDUAL" | "BUSINESS"; business_type?: string; pan: string };
}

/** The body of POST /orders, as Cashfree names it. */
export interface CashfreeCreateOrderBody {
  order_id: string;
  order_amount: number;
  order_currency: "INR";
  customer_details: {
    customer_id: string;
    customer_phone: string;
    customer_email?: string;
    customer_name?: string;
  };
  order_expiry_time: string;
  order_tags?: Record<string, string>;
  order_meta?: { return_url?: string; notify_url?: string };
  order_splits?: { vendor_id: string; amount: number }[];
}
