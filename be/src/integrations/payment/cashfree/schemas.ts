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
 * A payment webhook's body (PAYMENT_SUCCESS_WEBHOOK and friends). Only the
 * event name and the order id are read; the rest -- amounts, the payment id,
 * whose 19 digits a JSON number can't hold -- comes from Get Payments.
 */
export const cashfreeWebhookSchema = z
  .object({
    type: z.string().min(1),
    data: z
      .object({ order: z.object({ order_id: z.string().min(1) }).passthrough().nullish() })
      .passthrough()
      .nullish(),
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
