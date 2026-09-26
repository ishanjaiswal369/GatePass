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
  })
  .passthrough();

export type CashfreeOrder = z.infer<typeof cashfreeOrderSchema>;

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
}
