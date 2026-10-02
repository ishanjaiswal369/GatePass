/**
 * Cashfree Create Order, checked against a fake Cashfree on localhost.
 *
 *   npm run test:cashfree
 *
 * No Cashfree account needed: a local HTTP server plays Cashfree, answering
 * each call from a script, and records what was sent. Two parts:
 *
 * - The client and gateway on their own: headers, body mapping, retries on
 *   5xx with the same idempotency key, no retry on 4xx, response checks, and
 *   that the secret never reaches an error.
 * - The booking flow in-process against the dev database (DATABASE_URL):
 *   phone gate, payment row + order at booking, replay without a second
 *   order, and recovery after the gateway failed. Everything it creates is
 *   deleted at the end.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

// Before anything reads config/env: this process is the cashfree provider,
// whatever .env says.
process.env.PAYMENT_PROVIDER = "cashfree";
process.env.CASHFREE_ENV = "sandbox";
process.env.CASHFREE_CLIENT_ID = "test-client-id";
process.env.CASHFREE_CLIENT_SECRET = "test-secret-must-never-leak";
process.env.CASHFREE_API_VERSION = "2026-01-01";
process.env.INTEGRATION_MAX_RETRIES = "2";
process.env.WEBHOOK_PUBLIC_URL = "https://hooks.gatepass.test";

const SECRET = process.env.CASHFREE_CLIENT_SECRET;

// ---- fake Cashfree ----

interface Seen {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: any;
}

type Reply = { status: number; body: unknown } | ((req: Seen) => { status: number; body: unknown });

const seen: Seen[] = [];
const script: Reply[] = [];

/** A successful Create Order answer for whatever was asked. */
const orderFor = (req: Seen) => ({
  status: 200,
  body: {
    cf_order_id: 2149460581 + seen.length,
    order_id: req.body.order_id,
    entity: "order",
    order_currency: "INR",
    order_amount: req.body.order_amount,
    order_status: "ACTIVE",
    payment_session_id: `session_${req.body.order_id}_${seen.length}`,
    order_expiry_time: req.body.order_expiry_time,
    order_splits: req.body.order_splits ?? [],
    created_at: new Date().toISOString(),
    customer_details: req.body.customer_details,
  },
});

/** A vendor answer: echoes the id (from the body or the path) with the given status. */
const vendorFor = (status: string) => (req: Seen) => ({
  status: 200,
  body: {
    vendor_id: req.body?.vendor_id ?? decodeURIComponent(req.url.split("/").pop()!),
    status,
    email: req.body?.email ?? "host@gatepass.test",
    name: req.body?.name ?? "Host",
    phone: Number(req.body?.phone ?? 9876543210),
    schedule_option: { settlement_schedule_message: "T+1 settlement at 11:00 AM", schedule_id: 1, merchant_default: true },
  },
});

/** An Order Pay answer for UPI, shaped as the sandbox answered on 2026-09-27. */
const QR_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const upiFor = (links?: Record<string, string>) => (req: Seen) => {
  const channel = req.body.payment_method.upi.channel;
  const sim = "https://payments-test.cashfree.com/pgbillpayuiapi/simulator/1457655315005187584?txnId=1";
  return {
    status: 200,
    body: {
      action: "custom",
      cf_payment_id: "1457655315005187584",
      channel,
      payment_method: "upi",
      payment_amount: 40,
      data: {
        url: null,
        payload:
          channel === "qrcode"
            ? { qrcode: QR_PNG }
            : links ?? { bhim: sim, default: sim, gpay: sim, paytm: sim, phonepe: sim, web: "https://sandbox.cashfree.com/pg/view/upi/x" },
        content_type: null,
        method: null,
      },
    },
  };
};

/** A Get Payments for Order answer: one attempt per entry, shaped as the sandbox answered on 2026-09-27. */
const paymentsFor = (entries: { status: string; amount: number; ref?: string; orderId?: string }[]) => (req: Seen) => ({
  status: 200,
  body: entries.map((e, i) => ({
    cf_payment_id: e.ref ?? `14576624119185505${String(i).padStart(2, "0")}`,
    entity: "payment",
    order_id: e.orderId ?? decodeURIComponent(req.url.split("/")[2]!),
    order_amount: e.amount,
    order_currency: "INR",
    payment_amount: e.amount,
    payment_currency: "INR",
    payment_status: e.status,
    payment_group: "upi",
    payment_completion_time: "2026-09-27T14:40:50+05:30",
    is_captured: e.status === "SUCCESS",
  })),
});

/** A Create Refund answer: accepted, still on its way (refunds have their own suite, test/cashfree-refunds.ts). */
const refundFor = (req: Seen) => ({
  status: 200,
  body: {
    cf_refund_id: "1553338",
    refund_id: req.body.refund_id,
    order_id: decodeURIComponent(req.url.split("/")[2]!),
    entity: "refund",
    refund_amount: req.body.refund_amount,
    refund_status: "PENDING",
  },
});

/** Whatever Cashfree would say by default: an order for /orders, a vendor being set up otherwise. */
const byDefault = (req: Seen) =>
  req.url.startsWith("/easy-split/vendors")
    ? vendorFor("IN_BENE_CREATION")(req)
    : req.url === "/orders/sessions"
      ? upiFor()(req)
      : /^\/orders\/[^/]+\/payments$/.test(req.url)
        ? paymentsFor([])(req)
        : /^\/orders\/[^/]+\/refunds$/.test(req.url)
          ? refundFor(req)
          : orderFor(req);

const server = createServer((request, response) => {
  let data = "";
  request.on("data", (chunk) => (data += chunk));
  request.on("end", () => {
    const req: Seen = { method: request.method!, url: request.url!, headers: request.headers, body: data ? JSON.parse(data) : null };
    seen.push(req);
    const next = script.shift() ?? byDefault;
    const { status, body } = typeof next === "function" ? next(req) : next;
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const FAKE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

// ---- harness ----

let failures = 0;
function check(name: string, ok: unknown, detail?: unknown) {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}`, detail ?? "");
  }
}
async function rejects(fn: () => Promise<unknown>): Promise<any> {
  try {
    await fn();
    return null;
  } catch (error) {
    return error;
  }
}
const reset = () => {
  seen.length = 0;
  script.length = 0;
};

const { CASHFREE_BASE_URLS, CashfreeClient } = await import("../src/integrations/payment/cashfree/client.js");
const { CashfreeGateway } = await import("../src/integrations/payment/cashfree/gateway.js");
const { IntegrationError } = await import("../src/integrations/errors.js");

// The factory reads this lazily; pointing sandbox at the fake is what makes
// the booking flow below talk to it.
(CASHFREE_BASE_URLS as { sandbox: string }).sandbox = FAKE_URL;

const client = new CashfreeClient({
  clientId: "test-client-id",
  clientSecret: SECRET!,
  apiVersion: "2026-01-01",
  baseUrl: FAKE_URL,
  timeoutMs: 2000,
  maxRetries: 2,
});
const gateway = new CashfreeGateway(client, "sandbox", SECRET!);

/** A webhook as Cashfree signs it: Base64(HMAC-SHA256(timestamp + raw body, secret)). */
const { createHmac } = await import("node:crypto");
const signed = (body: object, secret = SECRET!) => {
  const raw = JSON.stringify(body);
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", secret).update(timestamp + raw).digest("base64");
  return { raw, headers: { "x-webhook-timestamp": timestamp, "x-webhook-signature": signature, "content-type": "application/json" } };
};
const successWebhook = (orderId: string) => ({
  type: "PAYMENT_SUCCESS_WEBHOOK",
  event_time: new Date().toISOString(),
  data: { order: { order_id: orderId, order_amount: 60, order_currency: "INR" }, payment: { cf_payment_id: 1457662411918550528, payment_status: "SUCCESS", payment_amount: 60 } },
});

const orderInput = () => ({
  orderId: `bk_${randomUUID()}`,
  amount: "140.00",
  currency: "INR" as const,
  customer: { id: "abc123", phone: "9876543210", email: "driver@gatepass.test", name: "Test Driver" },
  expiresAt: new Date(Date.now() + 15 * 60_000),
  tags: { booking_id: "b1" },
  idempotencyKey: randomUUID(),
});

// ---- part 1: client + gateway ----

console.log("\nClient and gateway");

{
  reset();
  const input = orderInput();
  const order = await gateway.createOrder(input);
  const [req] = seen;
  check("POST /orders", req?.method === "POST" && req.url === "/orders", req?.url);
  check("auth + version headers", req?.headers["x-client-id"] === "test-client-id" && req.headers["x-client-secret"] === SECRET && req.headers["x-api-version"] === "2026-01-01");
  check("x-request-id is a UUID", /^[0-9a-f-]{36}$/.test(String(req?.headers["x-request-id"])));
  check("x-idempotency-key is the input's", req?.headers["x-idempotency-key"] === input.idempotencyKey);
  check("body maps to Cashfree's names", req?.body.order_id === input.orderId && req.body.order_amount === 140 && req.body.order_currency === "INR" && req.body.customer_details.customer_phone === "9876543210" && req.body.customer_details.customer_id === "abc123" && req.body.order_tags.booking_id === "b1");
  check("expiry sent as ISO", req?.body.order_expiry_time === input.expiresAt.toISOString());
  check("answer mapped back", order.orderId === input.orderId && order.status === "ACTIVE" && order.amount === "140.00" && order.sessionId.startsWith("session_") && typeof order.orderRef === "string");
}

{
  reset();
  const input = { ...orderInput(), splits: [{ vendorId: "host_abc123", amount: "126.00" }] };
  await gateway.createOrder(input);
  check("splits sent as order_splits (vendor_id + amount in rupees)", JSON.stringify(seen[0]?.body.order_splits) === JSON.stringify([{ vendor_id: "host_abc123", amount: 126 }]), seen[0]?.body.order_splits);
}

{
  reset();
  script.push((req) => {
    const ok = orderFor(req);
    return { ...ok, body: { ...ok.body, order_splits: [{ vendor_id: "host_abc123", amount: 140 }] } };
  });
  const error = await rejects(() => gateway.createOrder({ ...orderInput(), splits: [{ vendorId: "host_abc123", amount: "126.00" }] }));
  check("an order whose split isn't the one asked for is refused", error instanceof IntegrationError && /split/.test(error.message), error?.message);
}

{
  reset();
  script.push({ status: 400, body: { message: "Vendor Not found", code: "order_splits_invalid", type: "invalid_request_error" } });
  const error = await rejects(() => gateway.createOrder({ ...orderInput(), splits: [{ vendorId: "host_gone", amount: "126.00" }] }));
  check("unknown vendor (Cashfree 400) -> not retried, IntegrationError", seen.length === 1 && error instanceof IntegrationError && error.statusCode === 400, error?.message);
}

{
  reset();
  script.push({ status: 500, body: { message: "internal Server Error", code: "internal_error", type: "api_error" } }, orderFor);
  const input = orderInput();
  const order = await gateway.createOrder(input);
  check("500 then 200: retried once and succeeds", seen.length === 2 && order.orderId === input.orderId, seen.length);
  check("retry keeps the idempotency key", seen[0]?.headers["x-idempotency-key"] === seen[1]?.headers["x-idempotency-key"]);
  check("each attempt has its own request id", seen[0]?.headers["x-request-id"] !== seen[1]?.headers["x-request-id"]);
}

{
  reset();
  script.push({ status: 400, body: { message: "order_amount : invalid value", code: "order_amount_invalid", type: "invalid_request_error" } });
  const error = await rejects(() => gateway.createOrder(orderInput()));
  check("400: not retried", seen.length === 1, seen.length);
  check("400: IntegrationError with Cashfree's code", error instanceof IntegrationError && error.message.includes("order_amount_invalid") && error.retryable === false && error.statusCode === 400, error?.message);
  const dumped = JSON.stringify({ error, raw: error?.raw, message: error?.message, stack: error?.stack });
  check("secret is nowhere in the error", !dumped.includes(SECRET!));
}

{
  reset();
  script.push({ status: 503, body: {} }, { status: 503, body: {} }, { status: 503, body: {} });
  const error = await rejects(() => gateway.createOrder(orderInput()));
  check("503 x3: gives up after 1 + 2 retries", seen.length === 3 && error instanceof IntegrationError && error.retryable, seen.length);
}

{
  reset();
  script.push({ status: 500, body: {} });
  const error = await rejects(() => client.request({ operation: "noKey", method: "POST", path: "/orders", body: {} }));
  check("POST without an idempotency key is never retried", seen.length === 1 && error instanceof IntegrationError, seen.length);
}

{
  reset();
  script.push((req) => {
    const ok = orderFor(req);
    return { ...ok, body: { ...ok.body, order_amount: 1 } };
  });
  const error = await rejects(() => gateway.createOrder(orderInput()));
  check("answer for a different amount is refused", error instanceof IntegrationError && /Unexpected/.test(error.message), error?.message);
}

{
  reset();
  script.push((req) => {
    const ok = orderFor(req);
    const { payment_session_id: _dropped, ...rest } = ok.body;
    return { ...ok, body: rest };
  });
  const error = await rejects(() => gateway.createOrder(orderInput()));
  check("answer without a session id is refused", error instanceof IntegrationError && /payment_session_id/.test(error.message), error?.message);
}

console.log("\nOrder Pay: UPI (gateway)");

const client_ = { device: "mobile" as const, os: "android" as const, rendering: "native" as const, browser: "others" as const };

{
  reset();
  const attempt = await gateway.startUpiPayment({ sessionId: "session_abc", channel: "INTENT", client: client_ });
  const [req] = seen;
  check("POST /orders/sessions with the session and upi link", req?.method === "POST" && req.url === "/orders/sessions" && req.body.payment_session_id === "session_abc" && req.body.payment_method.upi.channel === "link");
  check("x-client-* headers sent", req?.headers["x-client-device"] === "mobile" && req.headers["x-client-os"] === "android" && req.headers["x-client-rendering-type"] === "native" && req.headers["x-client-browser"] === "others");
  check("no idempotency key on Order Pay", req?.headers["x-idempotency-key"] === undefined);
  check("INTENT: the five app links, not the 'web' page", attempt.channel === "INTENT" && Object.keys(attempt.apps).sort().join() === "bhim,default,gpay,paytm,phonepe" && attempt.paymentRef === "1457655315005187584", attempt);
}

{
  reset();
  script.push(
    upiFor({
      default: "upi://pay?pa=cashfree@testbank&am=40.00",
      gpay: "tez://upi/pay?pa=cashfree@testbank",
      phonepe: "javascript:alert(1)",
      paytm: "https://cashfree.com.evil.example/pay",
      bhim: "http://payments-test.cashfree.com/x",
    })
  );
  const attempt = await gateway.startUpiPayment({ sessionId: "session_abc", channel: "INTENT", client: client_ });
  check("links outside the allow-list are dropped (javascript:, lookalike host, plain http)", attempt.channel === "INTENT" && Object.keys(attempt.apps).sort().join() === "default,gpay", attempt);
}

{
  reset();
  script.push(upiFor({ default: "https://evil.example/pay" }));
  const error = await rejects(() => gateway.startUpiPayment({ sessionId: "session_abc", channel: "INTENT", client: client_ }));
  check("no safe link left -> refused", error instanceof IntegrationError && /Unexpected/.test(error.message), error?.message);
}

{
  reset();
  const attempt = await gateway.startUpiPayment({ sessionId: "session_abc", channel: "QR", client: { device: "desktop", os: "windows", browser: "chrome" } });
  check("QR: channel qrcode, PNG data URL back", seen[0]?.body.payment_method.upi.channel === "qrcode" && attempt.channel === "QR" && attempt.qrImage === QR_PNG);
  check("QR: no rendering header when not given", seen[0]?.headers["x-client-rendering-type"] === undefined);
}

{
  reset();
  script.push((req) => {
    const ok = upiFor()(req);
    return { ...ok, body: { ...ok.body, data: { ...ok.body.data, payload: { qrcode: "data:text/html;base64,PHNjcmlwdD4=" } } } };
  });
  const error = await rejects(() => gateway.startUpiPayment({ sessionId: "session_abc", channel: "QR", client: client_ }));
  check("QR that isn't a PNG data URL -> refused", error instanceof IntegrationError, error?.message);
}

{
  reset();
  script.push({ status: 500, body: { message: "oops", code: "internal_error", type: "api_error" } });
  const error = await rejects(() => gateway.startUpiPayment({ sessionId: "session_abc", channel: "INTENT", client: client_ }));
  check("Order Pay 500 -> not retried (an attempt isn't idempotent)", seen.length === 1 && error instanceof IntegrationError, seen.length);
}

console.log("\nWebhook signature (gateway)");

{
  const { raw, headers } = signed(successWebhook("bk_abc"));
  const notice = gateway.readWebhook(raw, headers);
  check("valid signature -> a PAYMENT notice with the order id", notice?.kind === "PAYMENT" && notice.orderId === "bk_abc" && notice.type === "PAYMENT_SUCCESS_WEBHOOK", notice);
  check("body changed after signing -> refused", gateway.readWebhook(raw.replace('"order_amount":60', '"order_amount":1'), headers) === null);
  check("same body re-serialised with other spacing -> refused (raw bytes only)", gateway.readWebhook(JSON.stringify(JSON.parse(raw), null, 2), headers) === null);
  const forged = signed(successWebhook("bk_abc"), "not-the-secret");
  check("signed with another secret -> refused", gateway.readWebhook(forged.raw, forged.headers) === null);
  check("timestamp changed -> refused", gateway.readWebhook(raw, { ...headers, "x-webhook-timestamp": "1" }) === null);
  check("no signature headers -> refused", gateway.readWebhook(raw, {}) === null);
}

{
  const status = signed({
    type: "VENDOR_STATUS_UPDATE",
    data: { merchant_vendor_id: "host_abc123", updated_status: "ACTIVE", past_status: "IN_BENE_CREATION", account_number: "026291800001191", phone: "9876543210" },
  });
  const notice = gateway.readWebhook(status.raw, status.headers);
  check("VENDOR_STATUS_UPDATE -> the vendor id only", notice?.kind === "VENDOR_STATUS" && notice.vendorId === "host_abc123" && !JSON.stringify(notice).includes("026291800001191"), notice);

  const settle = (type: string, extra: object = {}) =>
    signed({
      type,
      event_time: "2026-09-29T15:10:37+05:30",
      data: {
        settlement: {
          settlement_id: 49703, status: type.replace("VENDOR_SETTLEMENT_", ""), utr: "1686217237243457", payment_amount: null,
          settlement_initiated_on: "2026-09-29T15:10:35+05:30", settled_on: "null", reason: null, adjustment: 0,
          settlement_amount: 180.0, service_charge: 0, service_tax: 0, amount_settled: null,
          payment_from: "2026-09-27", payment_till: "2026-09-27", vendor_id: "host_abc123", vendor_transaction_amount: 180.0,
          account_mode: "BANK", settled_orders_count: 5, ...extra,
        },
      },
    });
  const initiated = gateway.readWebhook(settle("VENDOR_SETTLEMENT_INITIATED").raw, settle("VENDOR_SETTLEMENT_INITIATED").headers);
  check(
    "VENDOR_SETTLEMENT_INITIATED -> id as string, amount, UTR; \"null\" read as null; a bare date is an Indian day",
    initiated?.kind === "VENDOR_SETTLEMENT" && initiated.settlement.id === "49703" && initiated.settlement.status === "INITIATED" &&
      initiated.settlement.amount === "180.00" && initiated.settlement.utr === "1686217237243457" && initiated.settlement.settledAt === null &&
      initiated.settlement.periodFrom?.toISOString() === "2026-09-26T18:30:00.000Z",
    initiated
  );
  const created = settle("VENDOR_SETTLEMENT_CREATED");
  check("the docs' other name, VENDOR_SETTLEMENT_CREATED -> INITIATED", (gateway.readWebhook(created.raw, created.headers) as any)?.settlement?.status === "INITIATED");
  const success = settle("VENDOR_SETTLEMENT_SUCCESS", { amount_settled: 179.5, settled_on: "2026-09-29T15:10:37+05:30" });
  const ok = gateway.readWebhook(success.raw, success.headers);
  check("SUCCESS -> amount_settled wins over settlement_amount", ok?.kind === "VENDOR_SETTLEMENT" && ok.settlement.amount === "179.50" && ok.settlement.settledAt !== null);
  const huge = settle("VENDOR_SETTLEMENT_SUCCESS", { settlement_id: 12345678901234567890 });
  check("a settlement id too big for a JS number -> not trusted (OTHER)", gateway.readWebhook(huge.raw, huge.headers)?.kind === "OTHER");
  const refund = signed({ type: "REFUND_STATUS_WEBHOOK", data: { refund: { refund_id: "r1" } } });
  check("an event we don't handle -> OTHER", gateway.readWebhook(refund.raw, refund.headers)?.kind === "OTHER");
}

{
  reset();
  await gateway.createOrder({ ...orderInput(), notifyUrl: "https://hooks.gatepass.test/webhooks/cashfree", returnUrl: "https://app.test/r" });
  check("notify_url and return_url sent in order_meta", seen[0]?.body.order_meta?.notify_url === "https://hooks.gatepass.test/webhooks/cashfree" && seen[0].body.order_meta.return_url === "https://app.test/r");
}

console.log("\nGet Payments for Order (gateway)");

{
  reset();
  script.push(paymentsFor([{ status: "USER_DROPPED", amount: 60 }, { status: "SUCCESS", amount: 60, ref: "1457662411918550528" }, { status: "SOMETHING_NEW", amount: 60 }]));
  const list = await gateway.getOrderPayments("bk_abc");
  check("GET /orders/:id/payments", seen[0]?.method === "GET" && seen[0].url === "/orders/bk_abc/payments");
  check("statuses mapped; an unknown one is UNKNOWN, never paid", list.map((p) => p.status).join() === "USER_DROPPED,SUCCESS,UNKNOWN");
  check("19-digit payment id kept exactly, amount to the paisa", list[1]?.paymentRef === "1457662411918550528" && list[1].amount === "60.00" && list[1].method === "upi");
}

{
  reset();
  script.push(paymentsFor([{ status: "SUCCESS", amount: 60, orderId: "bk_someone_else" }]));
  const error = await rejects(() => gateway.getOrderPayments("bk_abc"));
  check("a payment of another order -> refused", error instanceof IntegrationError, error?.message);
}

{
  reset();
  script.push((req) => {
    const ok = paymentsFor([{ status: "SUCCESS", amount: 60 }])(req);
    return { ...ok, body: ok.body.map((p) => ({ ...p, cf_payment_id: 1457662411918550528 })) };
  });
  const error = await rejects(() => gateway.getOrderPayments("bk_abc"));
  check("a numeric payment id (would lose digits) -> refused", error instanceof IntegrationError, error?.message);
}

console.log("\nVendor (gateway)");

const { VendorExistsError } = await import("../src/integrations/payment/provider.js");

const vendorInput = (accountType: "INDIVIDUAL" | "BUSINESS" = "INDIVIDUAL") => ({
  vendorId: "host_abc123",
  name: "Ravi Kumar!!",
  email: "ravi@gatepass.test",
  phone: "9876543210",
  bank: { accountNumber: "026291800001191", accountHolder: "RAVI KUMAR", ifsc: "YESB0000262" },
  kyc: { accountType, businessType: "Travel and Hospitality", pan: "ABCPV1234D" },
  idempotencyKey: randomUUID(),
});

{
  reset();
  const input = vendorInput();
  const vendor = await gateway.createVendor(input);
  const [req] = seen;
  check("createVendor: POST /easy-split/vendors", req?.method === "POST" && req.url === "/easy-split/vendors", req?.url);
  check("createVendor: id, contact, bank mapped", req?.body.vendor_id === "host_abc123" && req.body.email === "ravi@gatepass.test" && req.body.phone === "9876543210" && req.body.bank.account_number === "026291800001191" && req.body.bank.account_holder === "RAVI KUMAR" && req.body.bank.ifsc === "YESB0000262");
  check("createVendor: status ACTIVE, penny-drop on, no dashboard", req?.body.status === "ACTIVE" && req.body.verify_account === true && req.body.dashboard_access === false);
  check("createVendor: individual KYC sends account_type and pan, no business_type (even if one is passed)", req?.body.kyc_details.account_type === "INDIVIDUAL" && req.body.kyc_details.pan === "ABCPV1234D" && !("business_type" in req.body.kyc_details));
  check("createVendor: name stripped to Cashfree's characters", req?.body.name === "Ravi Kumar", req?.body.name);
  check("createVendor: idempotency key sent", req?.headers["x-idempotency-key"] === input.idempotencyKey);
  check("IN_BENE_CREATION -> PENDING", vendor.state === "PENDING" && vendor.providerStatus === "IN_BENE_CREATION" && !vendor.issue);
}

{
  reset();
  await gateway.createVendor(vendorInput("BUSINESS"));
  check("business KYC sends business_type", seen[0]?.body.kyc_details.account_type === "BUSINESS" && seen[0]?.body.kyc_details.business_type === "Travel and Hospitality");
}

{
  reset();
  script.push({ status: 409, body: { message: "vendor already exists", code: "vendor_already_exists", type: "invalid_request_error" } });
  const error = await rejects(() => gateway.createVendor(vendorInput()));
  check("createVendor on a taken id -> VendorExistsError", error instanceof VendorExistsError, error?.message);
}

{
  reset();
  script.push(vendorFor("ACTIVE"));
  const vendor = await gateway.updateVendor(vendorInput());
  check("updateVendor: PATCH /easy-split/vendors/:id without vendor_id in the body", seen[0]?.method === "PATCH" && seen[0].url === "/easy-split/vendors/host_abc123" && !("vendor_id" in seen[0].body));
  check("ACTIVE -> ACTIVE", vendor.state === "ACTIVE");
}

{
  const states: [string, string, string | undefined][] = [
    ["ACTION_REQUIRED", "FAILED", "KYC"],
    ["BANK_VALIDATION_FAILED", "FAILED", "BANK_ACCOUNT"],
    ["BENE_CREATION_FAILED", "FAILED", "BANK_ACCOUNT"],
    ["BLOCKED", "FAILED", "BLOCKED"],
    ["ON_HOLD", "PENDING", undefined],
    ["SOMETHING_NEW", "PENDING", undefined],
  ];
  let allOk = true;
  for (const [status, state, issue] of states) {
    reset();
    script.push(vendorFor(status));
    const vendor = await gateway.getVendor("host_abc123");
    if (vendor.state !== state || vendor.issue !== issue) allOk = false;
  }
  check("getVendor: GET /easy-split/vendors/:id", seen[0]?.method === "GET" && seen[0].url === "/easy-split/vendors/host_abc123");
  check("status map: ACTION_REQUIRED/BANK_*/BLOCKED fail with an issue; ON_HOLD and unknown stay pending", allOk);
}

// ---- part 2: the booking flow, against the database ----

console.log("\nBooking flow (dev database)");

const { prisma } = await import("../src/lib/prisma.js");
const bookingService = await import("../src/services/booking.service.js");
const paymentService = await import("../src/services/payment.service.js");

const RUN = Date.now().toString(36);
const userIds: string[] = [];
let listingId: string | undefined;
const extraListingIds: string[] = [];

try {
  const host = await prisma.user.create({ data: { email: `cf-test-${RUN}-host@gatepass.test`, firstName: "Test", lastName: "Host" } });
  const noPhone = await prisma.user.create({ data: { email: `cf-test-${RUN}-nophone@gatepass.test`, firstName: "No", lastName: "Phone" } });
  // A random, valid-looking number: the column is unique across the dev DB.
  const phone = `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
  const driver = await prisma.user.create({ data: { email: `cf-test-${RUN}-driver@gatepass.test`, phone, firstName: "Test", lastName: "Driver" } });
  userIds.push(host.id, noPhone.id, driver.id);

  const now = new Date();
  const HOST_VENDOR = `host_cftest${RUN}`;
  const profile = await prisma.hostProfile.create({ data: { userId: host.id, verificationStatus: "ACTIVE", payoutKycStatus: "ACTIVATED", payoutAccountId: HOST_VENDOR } });
  const spot = await prisma.listing.create({
    data: {
      hostProfileId: profile.id,
      listingType: "INDEPENDENT_SPOT",
      status: "PUBLISHED",
      name: `Cashfree test spot ${RUN}`,
      venueName: `Cashfree test spot ${RUN}`,
      spaceType: "DRIVEWAY",
      addressLine: "Test lane",
      city: "Unnao",
      state: "Uttar Pradesh",
      pincode: "209801",
      latitude: 26.5447,
      longitude: 80.4846,
      vehicleTypes: ["CAR"],
      accessInstructions: "Test",
      entryPoint: "Test gate",
      warrantyAcceptedAt: now,
      submittedAt: now,
      docApprovedAt: now,
      reviewedAt: now,
      createdBy: host.id,
      updatedBy: host.id,
      pricing: { create: [{ vehicleType: "CAR", pricePerHour: 60, pricePerDay: 300 }] },
      availability: { create: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 24 * 60 })) },
    },
  });
  listingId = spot.id;

  const HOUR = 60 * 60_000;
  const base = Math.ceil(Date.now() / HOUR) * HOUR + 24 * HOUR;
  const stay = (offsetHours: number) => ({
    listingId: spot.id,
    vehicleType: "CAR",
    vehicleNumber: "UP35AB1234",
    startsAt: new Date(base + offsetHours * HOUR),
    endsAt: new Date(base + (offsetHours + 2) * HOUR),
    idempotencyKey: `cf-test-${RUN}-${offsetHours}`,
  });

  // No phone: refused before anything is held.
  reset();
  const refused = await rejects(() => bookingService.createSpotBooking(stay(0), noPhone.id));
  const heldForNoPhone = await prisma.booking.count({ where: { driverId: noPhone.id } });
  check("no phone -> 409 PHONE_REQUIRED", refused?.statusCode === 409 && refused?.extra?.code === "PHONE_REQUIRED", refused?.message);
  check("no phone -> nothing held, Cashfree not called", heldForNoPhone === 0 && seen.length === 0);

  // With a phone: booking, payment row, order.
  reset();
  const first = await bookingService.createSpotBooking(stay(0), driver.id);
  const row = await prisma.payment.findUnique({ where: { bookingId: first.booking.id } });
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: first.booking.id } });
  const total = booking.amount.add(booking.platformFee).add(booking.taxAmount);
  const sent = seen[0]?.body;
  check("201-path returns checkout", first.replayed === false && first.booking.checkout?.paymentSessionId?.startsWith("session_") && first.booking.checkout.environment === "sandbox", first.booking.checkout);
  check("one Cashfree call", seen.length === 1, seen.length);
  check("payment row: full total, CREATED, ids stored", row?.status === "CREATED" && row.amount.equals(total) && row.gatewayOrderId === `bk_${booking.id}` && row.gatewaySessionId === first.booking.checkout?.paymentSessionId && Boolean(row.gatewayOrderRef), row);
  check("order amount = parking + fee + GST, from the booking", sent?.order_amount === Number(total.toFixed(2)), { sent: sent?.order_amount, total: total.toString() });
  const expiry = Date.parse(sent?.order_expiry_time ?? "");
  check("order expires with the hold, but never 15 min or less ahead (Cashfree refuses that)", expiry >= booking.holdExpiresAt!.getTime() && expiry > Date.now() + 15 * 60_000 && expiry <= Date.now() + 17 * 60_000, { sent: sent?.order_expiry_time, hold: booking.holdExpiresAt });
  check("idempotency key is the payment row's id", seen[0]?.headers["x-idempotency-key"] === row?.id);
  check("customer: 10-digit phone, alphanumeric id", sent?.customer_details.customer_phone === phone.slice(3) && sent.customer_details.customer_id === driver.id.replace(/-/g, ""));
  check("tags carry ids only", sent?.order_tags.booking_id === booking.id && sent.order_tags.listing_id === spot.id && Object.keys(sent.order_tags).length === 2);
  const share = booking.amount.mul(1 - Number(process.env.COMMISSION_RATE)).toDecimalPlaces(2);
  check("order carries the host's split: their vendor, parking less the service fee", JSON.stringify(sent?.order_splits) === JSON.stringify([{ vendor_id: HOST_VENDOR, amount: Number(share.toFixed(2)) }]), { sent: sent?.order_splits, share: share.toString() });
  check("split fixed on the payment row", row?.splitVendorId === HOST_VENDOR && row.splitAmount?.equals(share), { vendor: row?.splitVendorId, amount: row?.splitAmount?.toString() });
  check("notify_url is WEBHOOK_PUBLIC_URL + /webhooks/cashfree", sent?.order_meta?.notify_url === "https://hooks.gatepass.test/webhooks/cashfree", sent?.order_meta);
  check("return_url points at /payments/return with Cashfree's {order_id}", /\/payments\/return\?order_id=\{order_id\}$/.test(sent?.order_meta?.return_url ?? ""), sent?.order_meta);

  // Order Pay through the service.
  console.log("\nOrder Pay: UPI (service)");
  reset();
  const upi = await paymentService.startUpi(booking.id, driver.id, { channel: "INTENT", client: client_ });
  check("startUpi: one Order Pay call with the booking's session, no second order", seen.length === 1 && seen[0]?.url === "/orders/sessions" && seen[0].body.payment_session_id === row?.gatewaySessionId, seen.map((s) => s.url));
  check("startUpi: app links + the order's expiry (the hold, or just after it)", upi.channel === "INTENT" && Boolean(upi.apps.gpay) && upi.expiresAt.getTime() >= booking.holdExpiresAt!.getTime() && upi.expiresAt.getTime() === row?.gatewayExpiresAt?.getTime());
  reset();
  const qrAttempt = await paymentService.startUpi(booking.id, driver.id, { channel: "QR", client: { device: "desktop", os: "windows", browser: "chrome" } });
  check("a second attempt (QR) on the same order", qrAttempt.channel === "QR" && seen.length === 1);

  reset();
  const notMine = await rejects(() => paymentService.startUpi(booking.id, noPhone.id, { channel: "INTENT", client: client_ }));
  check("someone else's booking -> 404, Cashfree not called", notMine?.statusCode === 404 && seen.length === 0, notMine?.message);

  const lapsed = await bookingService.createSpotBooking(stay(8), driver.id);
  await prisma.booking.update({ where: { id: lapsed.booking.id }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
  reset();
  const late = await rejects(() => paymentService.startUpi(lapsed.booking.id, driver.id, { channel: "INTENT", client: client_ }));
  check("hold ended -> 409 NOT_PAYABLE, Cashfree not called", late?.statusCode === 409 && late?.code === "NOT_PAYABLE" && seen.length === 0, late?.message);

  const { paymentRequests } = await import("../src/requests/payment.request.js");
  const body = paymentRequests.startUpi.body;
  check("payload: an amount or a link is refused (strict)", !body.safeParse({ channel: "INTENT", client: client_, amount: 1 }).success && !body.safeParse({ channel: "INTENT", client: { ...client_, url: "x" } }).success);
  check("payload: COLLECT / netbanking aren't channels", !body.safeParse({ channel: "COLLECT", client: client_ }).success && !body.safeParse({ channel: "NETBANKING", client: client_ }).success);

  const options = paymentService.paymentOptions();
  check("options: sandbox offers UPI and CARD", options.enabled && options.methods.join() === "UPI,CARD" && options.environment === "sandbox");

  const id = booking.id;
  check("return: phone -> gatepass:// pay screen", paymentService.returnTarget(`bk_${id}`, "Mozilla/5.0 (Linux; Android 14)") === `gatepass://booking/${id}/pay`);
  check("return: desktop -> web app pay screen", paymentService.returnTarget(`bk_${id}`, "Mozilla/5.0 (Windows NT 10.0)").endsWith(`/booking/${id}/pay`) && paymentService.returnTarget(`bk_${id}`, undefined).startsWith("http"));
  const badReturn = [`bk_${id}/../../x`, "https://evil.example", `bk_${id}?next=//evil`, "bk_not-a-uuid"].map((v) => {
    try {
      paymentService.returnTarget(v, "");
      return false;
    } catch (e: any) {
      return e.statusCode === 400;
    }
  });
  check("return: anything but bk_<uuid> -> 400", badReturn.every(Boolean), badReturn);

  // Replay: same order, no second call.
  reset();
  const replay = await bookingService.createSpotBooking(stay(0), driver.id);
  check("replay -> same booking and session, Cashfree not called", replay.replayed && replay.booking.id === first.booking.id && replay.booking.checkout?.paymentSessionId === first.booking.checkout?.paymentSessionId && seen.length === 0, seen.length);

  // Gateway fails: the hold and row stay; the replay opens the same order.
  reset();
  script.push({ status: 400, body: { message: "bad", code: "request_invalid", type: "invalid_request_error" } });
  const failed = await rejects(() => bookingService.createSpotBooking(stay(4), driver.id));
  const kept = await prisma.booking.findUnique({ where: { idempotencyKey: `cf-test-${RUN}-4` }, include: { payment: true } });
  check("gateway 400 -> IntegrationError (API answers 502)", failed instanceof IntegrationError, failed?.message);
  check("hold and payment row kept, no session yet", kept?.status === "PENDING" && kept.payment?.status === "CREATED" && kept.payment.gatewaySessionId === null);
  reset();
  const recovered = await bookingService.createSpotBooking(stay(4), driver.id);
  check("replay after failure opens the order", recovered.replayed && Boolean(recovered.booking.checkout?.paymentSessionId) && seen.length === 1);
  check("...with the same order id and idempotency key", seen[0]?.body.order_id === `bk_${kept?.id}` && seen[0]?.headers["x-idempotency-key"] === kept?.payment?.id);
  check("...and the same split", seen[0]?.body.order_splits?.[0]?.vendor_id === HOST_VENDOR);

  // History: no gateway ids.
  const history = await paymentService.listForDriver(driver.id);
  const keys = new Set(history.flatMap((p) => Object.keys(p)));
  check("GET /payments rows carry no gateway ids or session", history.length === 3 && ![...keys].some((k) => k.startsWith("gateway") || k === "provider"), [...keys]);

  // ---- A host the gateway can't pay: no hold, no order ----
  console.log("\nHost without a payee (dev database)");
  await prisma.hostProfile.update({ where: { id: profile.id }, data: { payoutAccountId: null } });
  reset();
  const unpayable = await rejects(() => bookingService.createSpotBooking(stay(36), driver.id));
  const heldUnpayable = await prisma.booking.count({ where: { idempotencyKey: `cf-test-${RUN}-36` } });
  check("host with no vendor -> 409 HOST_NOT_PAYABLE, nothing held, Cashfree not called", unpayable?.statusCode === 409 && unpayable?.code === "HOST_NOT_PAYABLE" && heldUnpayable === 0 && seen.length === 0, unpayable?.message);
  await prisma.hostProfile.update({ where: { id: profile.id }, data: { payoutAccountId: HOST_VENDOR } });

  // ---- Get Payments for Order -> confirm, or refund ----
  console.log("\nPaid -> confirmed or refunded (dev database)");
  const confirm = await import("../src/services/payment-confirmation.service.js");
  const hooks = await import("../src/services/gateway-webhook.service.js");
  const seenPayments = () => seen.filter((r) => /\/payments$/.test(r.url)).length;
  const paid = async (bookingId: string, amount?: number) => {
    const p = await prisma.payment.findUniqueOrThrow({ where: { bookingId } });
    script.push(paymentsFor([{ status: "FAILED", amount: Number(p.amount) }, { status: "SUCCESS", amount: amount ?? Number(p.amount) }]));
  };
  const state = (id: string) =>
    prisma.booking.findUniqueOrThrow({
      where: { id },
      select: { status: true, payment: { select: { status: true, gatewayPaymentId: true } }, refund: { select: { policy: true, amount: true, status: true } } },
    });

  // Nothing paid yet: stays as it is.
  const unpaid = await bookingService.createSpotBooking(stay(12), driver.id);
  reset();
  await confirm.refreshPayment(unpaid.booking.id, driver.id);
  check("no SUCCESS yet -> still PENDING / CREATED", (await state(unpaid.booking.id)).status === "PENDING" && seenPayments() === 1);
  reset();
  await confirm.refreshPayment(unpaid.booking.id, driver.id);
  check("asked again within 5 s -> Cashfree not called", seen.length === 0, seen.length);

  // Paid while held: confirmed, through the booking read the pay screen polls.
  await prisma.payment.update({ where: { bookingId: unpaid.booking.id }, data: { gatewayCheckedAt: null } });
  reset();
  await paid(unpaid.booking.id);
  const detail = await bookingService.getForDriver(unpaid.booking.id, driver.id);
  const after = await state(unpaid.booking.id);
  check("SUCCESS -> booking CONFIRMED, payment CAPTURED with the payment id", detail.status === "CONFIRMED" && after.payment?.status === "CAPTURED" && after.payment.gatewayPaymentId === "1457662411918550501", after);
  check("...and the detail read now releases the access details", Boolean(detail.access));
  reset();
  await bookingService.getForDriver(unpaid.booking.id, driver.id);
  check("settled -> later reads don't call Cashfree", seen.length === 0);

  // Someone else's booking: no check on their behalf.
  const other = await bookingService.createSpotBooking(stay(16), driver.id);
  reset();
  await confirm.refreshPayment(other.booking.id, noPhone.id);
  check("another driver's read -> Cashfree not called", seen.length === 0);

  // Wrong amount: never confirmed.
  reset();
  await paid(other.booking.id, 1);
  await confirm.refreshPayment(other.booking.id, driver.id);
  const wrong = await state(other.booking.id);
  check("SUCCESS for a different amount -> not captured, not confirmed", wrong.status === "PENDING" && wrong.payment?.status === "CREATED", wrong);

  // Hold lapsed but nobody took the hours (still PENDING): confirmed.
  await prisma.booking.update({ where: { id: other.booking.id }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
  await prisma.payment.update({ where: { bookingId: other.booking.id }, data: { gatewayCheckedAt: null } });
  reset();
  await paid(other.booking.id);
  await confirm.refreshPayment(other.booking.id, driver.id);
  check("paid after the hold lapsed, hours untouched -> CONFIRMED", (await state(other.booking.id)).status === "CONFIRMED");

  // Lapsed, swept by someone else's attempt, hours still free: revived.
  const swept = await bookingService.createSpotBooking(stay(20), driver.id);
  await prisma.booking.update({ where: { id: swept.booking.id }, data: { holdExpiresAt: new Date(Date.now() - 60_000), status: "CANCELLED" } });
  reset();
  await paid(swept.booking.id);
  await confirm.refreshPayment(swept.booking.id, driver.id);
  check("swept hold, hours still free -> CONFIRMED again", (await state(swept.booking.id)).status === "CONFIRMED");

  // Lapsed, swept, and the hours taken by another driver: full refund.
  const second = await prisma.user.create({
    data: { email: `cf-test-${RUN}-second@gatepass.test`, firstName: "Second", lastName: "Driver", phone: `+918${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}` },
  });
  userIds.push(second.id);
  const lost = await bookingService.createSpotBooking(stay(24), driver.id);
  await prisma.booking.update({ where: { id: lost.booking.id }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
  const taker = await bookingService.createSpotBooking({ ...stay(24), idempotencyKey: `cf-test-${RUN}-taker` }, second.id);
  check("(setup) another driver's attempt sweeps the lapsed hold and takes the hours", (await state(lost.booking.id)).status === "CANCELLED" && taker.booking.status === "PENDING");
  reset();
  await paid(lost.booking.id);
  await confirm.refreshPayment(lost.booking.id, driver.id);
  const lostState = await state(lost.booking.id);
  check(
    "hours taken -> stays CANCELLED, payment CAPTURED, full refund HOLD_LAPSED",
    lostState.status === "CANCELLED" && lostState.payment?.status === "CAPTURED" && lostState.refund?.policy === "HOLD_LAPSED" && lostState.refund.status === "REFUND_PENDING" && Number(lostState.refund.amount) === Number(lost.booking.amount),
    lostState
  );
  const outcome = await confirm.resolvePaidBooking(lost.booking.id);
  check("running it again changes nothing (one refund)", outcome === "ALREADY_SETTLED" && (await prisma.refund.count({ where: { bookingId: lost.booking.id } })) === 1);

  // Cancelled by the driver before the payment landed: full refund.
  const quit = await bookingService.createSpotBooking(stay(28), driver.id);
  await prisma.booking.update({ where: { id: quit.booking.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  reset();
  await paid(quit.booking.id);
  await confirm.refreshPayment(quit.booking.id, driver.id);
  check("driver cancelled, then the payment landed -> refund CANCELLED_BEFORE_PAYMENT", (await state(quit.booking.id)).refund?.policy === "CANCELLED_BEFORE_PAYMENT");

  // ---- Webhook: signature, then the same Get Payments check ----
  console.log("\nWebhook -> confirmed (dev database)");
  const hooked = await bookingService.createSpotBooking(stay(40), driver.id);
  const hookedOrder = `bk_${hooked.booking.id}`;
  // A screen checked a moment ago: a webhook isn't held back by that.
  await prisma.payment.update({ where: { bookingId: hooked.booking.id }, data: { gatewayCheckedAt: new Date() } });

  reset();
  const forgedHook = signed(successWebhook(hookedOrder), "not-the-secret");
  const refusedHook = await hooks.receiveGatewayWebhook(forgedHook.raw, forgedHook.headers);
  check("forged webhook -> BAD_SIGNATURE, Cashfree not asked, still PENDING", refusedHook === "BAD_SIGNATURE" && seen.length === 0 && (await state(hooked.booking.id)).status === "PENDING");

  reset();
  script.push({ status: 503, body: {} }, { status: 503, body: {} }, { status: 503, body: {} });
  const realHook = signed(successWebhook(hookedOrder));
  const outage = await rejects(() => hooks.receiveGatewayWebhook(realHook.raw, realHook.headers));
  check("Cashfree down while handling -> throws (route answers 5xx, Cashfree retries)", outage instanceof IntegrationError);

  reset();
  await paid(hooked.booking.id);
  const handled = await hooks.receiveGatewayWebhook(realHook.raw, realHook.headers);
  const hookedState = await state(hooked.booking.id);
  check("genuine webhook -> Get Payments asked despite a recent check -> CONFIRMED", handled === "HANDLED" && seenPayments() === 1 && hookedState.status === "CONFIRMED" && hookedState.payment?.status === "CAPTURED", { handled, hookedState });
  check("payment id taken from Get Payments (string), not the webhook's JSON number", hookedState.payment?.gatewayPaymentId === "1457662411918550501", hookedState.payment?.gatewayPaymentId);

  reset();
  await paid(hooked.booking.id);
  const repeated = await hooks.receiveGatewayWebhook(realHook.raw, realHook.headers);
  check("the same webhook again -> nothing changes", repeated === "HANDLED" && (await state(hooked.booking.id)).status === "CONFIRMED" && (await prisma.refund.count({ where: { bookingId: hooked.booking.id } })) === 0);

  reset();
  const stranger = signed(successWebhook("bk_00000000-0000-4000-8000-000000000000"));
  check("webhook for an order that isn't ours -> IGNORED (200), Cashfree not asked", (await hooks.receiveGatewayWebhook(stranger.raw, stranger.headers)) === "IGNORED" && seen.length === 0);

  // An order long closed isn't asked about any more.
  const old = await bookingService.createSpotBooking(stay(32), driver.id);
  await prisma.payment.update({ where: { bookingId: old.booking.id }, data: { gatewayExpiresAt: new Date(Date.now() - 2 * 60 * 60_000) } });
  reset();
  await confirm.refreshPayment(old.booking.id, driver.id);
  check("order closed over 30 min ago -> Cashfree not called", seen.length === 0);

  // ---- Step 9: the host's payout account as a Cashfree vendor ----
  console.log("\nHost payout -> vendor (dev database)");
  const payout = await import("../src/services/host-payout.service.js");

  const newHost = await prisma.user.create({ data: { email: `cf-test-${RUN}-newhost@gatepass.test`, firstName: "Ravi", lastName: "Kumar" } });
  userIds.push(newHost.id);
  const newProfile = await prisma.hostProfile.create({ data: { userId: newHost.id, verificationStatus: "ACTIVE" } });
  // Approved by an admin and waiting only on the payout account.
  const waiting = await prisma.listing.create({
    data: {
      hostProfileId: newProfile.id,
      listingType: "INDEPENDENT_SPOT",
      status: "PENDING_REVIEW",
      name: `Cashfree waiting spot ${RUN}`,
      venueName: `Cashfree waiting spot ${RUN}`,
      spaceType: "DRIVEWAY",
      addressLine: "Test lane",
      city: "Unnao",
      state: "Uttar Pradesh",
      pincode: "209801",
      latitude: 26.5447,
      longitude: 80.4846,
      vehicleTypes: ["CAR"],
      accessInstructions: "Test",
      warrantyAcceptedAt: now,
      submittedAt: now,
      docApprovedAt: now,
      createdBy: newHost.id,
      updatedBy: newHost.id,
      pricing: { create: [{ vehicleType: "CAR", pricePerHour: 60, pricePerDay: 300 }] },
      availability: { create: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 24 * 60 })) },
    },
  });
  extraListingIds.push(waiting.id);

  const details = { panNumber: "ABCPV1234D", accountHolderName: "RAVI KUMAR", accountNumber: "026291800001191", ifsc: "YESB0000262", accountType: "INDIVIDUAL" as const };

  // The accepted payload (requests/host-payout.request): what the route lets through.
  const { hostPayoutRequests } = await import("../src/requests/host-payout.request.js");
  const accepts = (body: object) => hostPayoutRequests.submit.body.safeParse(body).success;
  check("payload: an individual sends no businessType", accepts(details));
  check("payload: a business must send businessType", !accepts({ ...details, accountType: "BUSINESS" }) && accepts({ ...details, accountType: "BUSINESS", businessType: "Travel and Hospitality" }));
  check("payload: businessType on an individual is refused", !accepts({ ...details, businessType: "Travel and Hospitality" }));
  check("payload: accountType is required", !accepts({ ...details, accountType: undefined }));
  check("payload: an unknown businessType is refused", !accepts({ ...details, accountType: "BUSINESS", businessType: "Casino" }));
  check("payload: an unknown field is refused (strict)", !accepts({ ...details, payoutKycStatus: "ACTIVATED" }));
  check("payload: phone must be a 10-digit Indian mobile", accepts({ ...details, phone: "9876543210" }) && accepts({ ...details, phone: "+919876543210" }) && !accepts({ ...details, phone: "12345" }));


  // Payout is set up off the Host tab now, not in the wizard: a listing is
  // ready to submit without it, and no rejection can point at it.
  const spotListing = await import("../src/services/spot-listing.service.js");
  const { adminSpotRequests } = await import("../src/requests/admin-spot.request.js");
  const readinessItems = await spotListing.readiness(waiting.id, newProfile.id);
  check("readiness never asks for a payout account", !readinessItems.some((item) => item.step === "payout"), readinessItems);
  const rejectBody = (adminSpotRequests as any).reject?.body;
  check("admin can't reject into a 'payout' section", rejectBody && !rejectBody.safeParse({ reason: "Bank details look wrong", section: "payout" }).success);

  const before = await payout.getStatus(newProfile.id);
  check("a host without a phone is asked for one", before.needsPhone === true && before.payoutKycStatus === "NOT_STARTED");

  reset();
  const noPhoneErr = await rejects(() => payout.submit(newProfile.id, details));
  check("submit without a phone -> 409 PHONE_REQUIRED, Cashfree not called", noPhoneErr?.statusCode === 409 && noPhoneErr?.extra?.code === "PHONE_REQUIRED" && seen.length === 0, noPhoneErr?.message);

  reset();
  script.push({ status: 400, body: { message: "bank.ifsc : invalid ifsc", code: "ifsc_invalid", type: "invalid_request_error" } });
  const hostPhone = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
  const refusedErr = await rejects(() => payout.submit(newProfile.id, { ...details, phone: hostPhone }));
  const afterRefusal = await prisma.hostProfile.findUniqueOrThrow({ where: { id: newProfile.id } });
  check("Cashfree refuses the details -> 422 with its reason", refusedErr?.statusCode === 422 && /invalid ifsc/.test(refusedErr?.message), refusedErr?.message);
  check("...and nothing but the phone is kept", afterRefusal.payoutKycStatus === "NOT_STARTED" && afterRefusal.payoutAccountId === null && afterRefusal.payoutAccountNumber === null);

  reset();
  const submitted = await payout.submit(newProfile.id, { ...details, phone: hostPhone });
  const savedUser = await prisma.user.findUniqueOrThrow({ where: { id: newHost.id } });
  const expectedVendorId = `host_${newProfile.id.replace(/-/g, "")}`;
  check("an individual is sent to Cashfree without business_type, and none is stored", seen[0]?.body.kyc_details.account_type === "INDIVIDUAL" && !("business_type" in (seen[0]?.body.kyc_details ?? {})) && submitted.businessType === null);
  check("submit -> Create Vendor with the host's id and 10-digit phone", seen.length === 1 && seen[0]?.method === "POST" && seen[0].body.vendor_id === expectedVendorId && seen[0].body.phone === hostPhone && seen[0].body.name === "Ravi Kumar");
  check("phone saved to the profile", savedUser.phone === `+91${hostPhone}`);
  check("IN_BENE_CREATION -> UNDER_REVIEW, vendor id stored, no phone asked any more", submitted.payoutKycStatus === "UNDER_REVIEW" && submitted.payoutAccountId === expectedVendorId && submitted.needsPhone === false && submitted.accountType === "INDIVIDUAL");
  check("response is masked", submitted.panNumber === "ABCPV****D" && submitted.accountNumberLast4 === "1191" && !JSON.stringify(submitted).includes("026291800001191"));

  reset();
  await payout.getStatus(newProfile.id);
  check("getStatus within 30 s: Cashfree not asked again", seen.length === 0, seen.length);

  reset();
  await prisma.hostProfile.update({ where: { id: newProfile.id }, data: { payoutCheckedAt: new Date(Date.now() - 60_000) } });
  script.push(vendorFor("BANK_VALIDATION_FAILED"));
  const failedView = await payout.getStatus(newProfile.id);
  check("stale + BANK_VALIDATION_FAILED -> REJECTED with issue BANK_ACCOUNT", seen[0]?.method === "GET" && failedView.payoutKycStatus === "REJECTED" && failedView.issue === "BANK_ACCOUNT", failedView);

  reset();
  script.push(vendorFor("ACTIVE"));
  const fixed = await payout.submit(newProfile.id, { ...details, accountNumber: "026291800001192" });
  const published = await prisma.listing.findUniqueOrThrow({ where: { id: waiting.id } });
  check("Fix details -> Update Vendor (PATCH), not a second create", seen.length === 1 && seen[0]?.method === "PATCH" && seen[0].url === `/easy-split/vendors/${expectedVendorId}`);
  check("ACTIVE -> ACTIVATED, issue cleared", fixed.payoutKycStatus === "ACTIVATED" && fixed.issue === null);
  check("activation publishes the listing that was waiting on it", published.status === "PUBLISHED", published.status);

  // Once active, the status is the database's: no gateway call.
  reset();
  await prisma.hostProfile.update({ where: { id: newProfile.id }, data: { payoutCheckedAt: new Date(Date.now() - 60_000) } });
  const activeView = await payout.getStatus(newProfile.id);
  check("active: GET reads the database, Cashfree not asked", seen.length === 0 && activeView.payoutKycStatus === "ACTIVATED", seen.length);

  // An active host changes bank account: Update Vendor, and the status follows
  // the gateway's re-check (owner's decision).
  reset();
  script.push(vendorFor("IN_BANK_VALIDATION"));
  const changed = await payout.submit(newProfile.id, { ...details, accountNumber: "026291800001193" });
  check("active host updating -> Update Vendor (PATCH)", seen.length === 1 && seen[0]?.method === "PATCH" && seen[0].url === `/easy-split/vendors/${expectedVendorId}`, seen.map((s) => s.method));
  check("...and goes back to 'being checked' until the new account is verified", changed.payoutKycStatus === "UNDER_REVIEW" && changed.accountNumberLast4 === "1193");

  const busy = await rejects(() => payout.submit(newProfile.id, details));
  check("while being checked, another change is refused (409)", busy?.statusCode === 409, busy?.message);

  // Two requests at once (Host tab + Payouts tab): one gateway call between them.
  reset();
  await prisma.hostProfile.update({ where: { id: newProfile.id }, data: { payoutCheckedAt: new Date(Date.now() - 60_000) } });
  await Promise.all([payout.getStatus(newProfile.id), payout.getStatus(newProfile.id), payout.getStatus(newProfile.id)]);
  check("three concurrent GETs while pending -> one Get Vendor call", seen.length === 1, seen.length);

  // The Payouts tab, before anything is listed: a signed-in user with no host
  // profile reads an empty account, and submitting makes them a host.
  const newcomer = await prisma.user.create({ data: { email: `cf-test-${RUN}-newcomer@gatepass.test`, firstName: "New", lastName: "Comer" } });
  userIds.push(newcomer.id);
  const empty = await payout.getStatusForUser(newcomer.id);
  const profilesAfterRead = await prisma.hostProfile.count({ where: { userId: newcomer.id } });
  check("no host profile: GET reads an empty NOT_STARTED account and asks for a phone", empty.payoutKycStatus === "NOT_STARTED" && empty.needsDetails && empty.needsPhone && empty.payoutAccountId === null);
  check("...and reading creates no host profile", profilesAfterRead === 0);
  reset();
  const newcomerPhone = `8${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
  const firstPayout = await payout.submitForUser(newcomer.id, { ...details, phone: newcomerPhone });
  const newcomerProfile = await prisma.hostProfile.findUnique({ where: { userId: newcomer.id } });
  check("submitting before listing creates the host profile and the vendor for it", Boolean(newcomerProfile) && seen[0]?.method === "POST" && seen[0].body.vendor_id === `host_${newcomerProfile!.id.replace(/-/g, "")}` && firstPayout.payoutKycStatus === "UNDER_REVIEW");
  const again = await payout.getStatusForUser(newcomer.id);
  check("GET after that reads the same account", again.payoutAccountId === firstPayout.payoutAccountId && again.needsPhone === false);

  // ---- Easy Split webhooks: vendor status, and transfers to the bank ----
  console.log("\nEasy Split webhooks (dev database)");
  const ledger = await import("../src/services/host-payout-ledger.service.js");
  const hostOps = await import("../src/services/host-operations.service.js");
  const payUser = await prisma.user.create({ data: { email: `cf-test-${RUN}-payhost@gatepass.test`, firstName: "Pay", lastName: "Host" } });
  userIds.push(payUser.id);
  const PAY_VENDOR = `host_cfpay${RUN}`;
  const payHost = await prisma.hostProfile.create({
    data: { userId: payUser.id, verificationStatus: "ACTIVE", payoutKycStatus: "UNDER_REVIEW", payoutAccountId: PAY_VENDOR, payoutAccountNumber: "026291800001191" },
  });
  const settlementHook = (id: number, type: string, extra: object = {}) =>
    signed({
      type,
      data: {
        settlement: {
          settlement_id: id, utr: `UTR${id}`, settlement_initiated_on: `2026-09-2${id % 10}T15:10:35+05:30`, settled_on: "null", reason: null,
          settlement_amount: 180, amount_settled: null, payment_from: "2026-09-27", payment_till: "2026-09-27", vendor_id: PAY_VENDOR, ...extra,
        },
      },
    });
  const payoutNotices = () => prisma.notification.findMany({ where: { userId: payUser.id, kind: "HOST_PAYOUT" }, select: { title: true, body: true } });

  // Vendor status: only the id is taken; Get Vendor decides.
  reset();
  script.push(vendorFor("ACTIVE"));
  const statusHook = signed({ type: "VENDOR_STATUS_UPDATE", data: { merchant_vendor_id: PAY_VENDOR, updated_status: "BLOCKED" } });
  const statusOutcome = await hooks.receiveGatewayWebhook(statusHook.raw, statusHook.headers);
  const afterStatus = await prisma.hostProfile.findUniqueOrThrow({ where: { id: payHost.id } });
  check("VENDOR_STATUS_UPDATE -> Get Vendor asked, its answer (not the body's) recorded", statusOutcome === "HANDLED" && seen[0]?.method === "GET" && seen[0].url === `/easy-split/vendors/${PAY_VENDOR}` && afterStatus.payoutKycStatus === "ACTIVATED", afterStatus.payoutKycStatus);
  reset();
  const strangerStatus = signed({ type: "VENDOR_STATUS_UPDATE", data: { merchant_vendor_id: "host_notours" } });
  check("vendor status for a vendor not ours -> IGNORED, Cashfree not asked", (await hooks.receiveGatewayWebhook(strangerStatus.raw, strangerStatus.headers)) === "IGNORED" && seen.length === 0);
  reset();
  script.push({ status: 503, body: {} }, { status: 503, body: {} }, { status: 503, body: {} });
  const statusOutage = await rejects(() => hooks.receiveGatewayWebhook(statusHook.raw, statusHook.headers));
  check("Cashfree down on the vendor check -> throws (5xx, resent later)", statusOutage instanceof IntegrationError);

  // A transfer: on its way, then landed.
  const one = Number(`9${String(Date.now()).slice(-8)}`);
  const initiatedHook = settlementHook(one, "VENDOR_SETTLEMENT_INITIATED");
  await hooks.receiveGatewayWebhook(initiatedHook.raw, initiatedHook.headers);
  const row1 = await prisma.hostPayout.findUnique({ where: { gatewaySettlementId: String(one) } });
  check("INITIATED -> a row on its way, no notification yet", row1?.status === "INITIATED" && Number(row1.amount) === 180 && (await payoutNotices()).length === 0, row1);
  const successHook = settlementHook(one, "VENDOR_SETTLEMENT_SUCCESS", { amount_settled: 180, settled_on: "2026-09-29T15:10:37+05:30" });
  await hooks.receiveGatewayWebhook(successHook.raw, successHook.headers);
  await hooks.receiveGatewayWebhook(successHook.raw, successHook.headers);
  const landed = await payoutNotices();
  check("SUCCESS (sent twice) -> SUCCESS, one 'Payout sent' with the amount, account and UTR", (await prisma.hostPayout.findUnique({ where: { gatewaySettlementId: String(one) } }))?.status === "SUCCESS" && landed.length === 1 && landed[0]!.title === "Payout sent" && /₹180/.test(landed[0]!.body) && /1191/.test(landed[0]!.body) && landed[0]!.body.includes(`UTR${one}`), landed);
  await hooks.receiveGatewayWebhook(initiatedHook.raw, initiatedHook.headers);
  check("a late INITIATED doesn't undo SUCCESS", (await prisma.hostPayout.findUnique({ where: { gatewaySettlementId: String(one) } }))?.status === "SUCCESS");

  let earned = await hostOps.earnings(payHost.id);
  check("earnings: paidOut is the landed transfer, shown as a 'Payout to your bank' row", earned.paidOut === "180" && earned.transactions.some((t) => t.kind === "PAYOUT" && t.title === "Payout to your bank" && t.state === "PAID_OUT" && t.amount === "-180" && t.sub.includes(`UTR${one}`)), { paidOut: earned.paidOut, tx: earned.transactions });
  check("payout account: no transfer issue after a success", earned.payoutAccount.lastTransferIssue === null);

  // A later transfer that fails on the host's account.
  const two = one + 1;
  const failedHook = settlementHook(two, "VENDOR_SETTLEMENT_FAILED", { reason: "INVALID_IFSC_FAIL", settlement_amount: 60 });
  await hooks.receiveGatewayWebhook(failedHook.raw, failedHook.headers);
  const failNotice = (await payoutNotices()).find((n) => n.title === "Payout couldn't reach your bank");
  const account = await (await import("../src/services/host-payout.service.js")).getStatus(payHost.id);
  check("FAILED (account reason) -> host told what to fix", Boolean(failNotice) && /IFSC/.test(failNotice!.body) && /Payouts screen/.test(failNotice!.body), failNotice);
  check("payout account shows the failed transfer as fixable", account.lastTransferIssue?.status === "FAILED" && account.lastTransferIssue.fixable === true && account.lastTransferIssue.amount === "60", account.lastTransferIssue);
  earned = await hostOps.earnings(payHost.id);
  check("a failed transfer isn't a row and doesn't count as paid out", earned.paidOut === "180" && !earned.transactions.some((t) => t.sub.includes(`UTR${two}`)));

  // The bank sends the first one back.
  const reversedHook = settlementHook(one, "VENDOR_SETTLEMENT_REVERSED", { reason: "Failed from bank end" });
  await hooks.receiveGatewayWebhook(reversedHook.raw, reversedHook.headers);
  earned = await hostOps.earnings(payHost.id);
  check("SUCCESS -> REVERSED: out of paidOut, and 'returned by your bank' told", earned.paidOut === "0" && (await payoutNotices()).some((n) => n.title === "Payout returned by your bank"));
  check("a bank-side reason isn't presented as the host's to fix", ledger.transferIssue("Failed from bank end").fixable === false && ledger.transferIssue("INVALID_ACCOUNT_FAIL").fixable === true);

  const strangerSettle = signed({ type: "VENDOR_SETTLEMENT_SUCCESS", data: { settlement: { settlement_id: 77, vendor_id: "host_notours", settlement_amount: 5 } } });
  check("settlement for a vendor not ours -> IGNORED, nothing stored", (await hooks.receiveGatewayWebhook(strangerSettle.raw, strangerSettle.headers)) === "IGNORED" && (await prisma.hostPayout.count({ where: { gatewaySettlementId: "77" } })) === 0);
  const forgedSettle = signed(JSON.parse(successHook.raw), "not-the-secret");
  check("forged settlement webhook -> BAD_SIGNATURE", (await hooks.receiveGatewayWebhook(forgedSettle.raw, forgedSettle.headers)) === "BAD_SIGNATURE");

  // A create whose answer was lost: the id is taken, so it becomes an update.
  const lostHost = await prisma.user.create({ data: { email: `cf-test-${RUN}-losthost@gatepass.test`, firstName: "Lost", lastName: "Answer", phone: `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}` } });
  userIds.push(lostHost.id);
  const lostProfile = await prisma.hostProfile.create({ data: { userId: lostHost.id, verificationStatus: "ACTIVE" } });
  reset();
  script.push({ status: 409, body: { message: "vendor already exists", code: "vendor_already_exists", type: "invalid_request_error" } });
  const recoveredVendor = await payout.submit(lostProfile.id, details);
  check("create -> 409 already exists -> update instead", seen.length === 2 && seen[0]?.method === "POST" && seen[1]?.method === "PATCH" && recoveredVendor.payoutKycStatus === "UNDER_REVIEW", seen.map((s) => s.method));
} finally {
  for (const id of [listingId, ...extraListingIds].filter(Boolean) as string[]) {
    await prisma.refund.deleteMany({ where: { booking: { listingId: id } } });
    await prisma.payment.deleteMany({ where: { booking: { listingId: id } } });
    await prisma.booking.deleteMany({ where: { listingId: id } });
    await prisma.listing.deleteMany({ where: { id } });
  }
  await prisma.hostPayout.deleteMany({ where: { hostProfile: { userId: { in: userIds } } } });
  await prisma.hostProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
  server.close();
}

console.log(failures ? `\n${failures} failed` : "\nAll passed");
process.exit(failures ? 1 : 0);
