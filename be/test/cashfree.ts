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

/** Whatever Cashfree would say by default: an order for /orders, a vendor being set up otherwise. */
const byDefault = (req: Seen) => (req.url.startsWith("/easy-split/vendors") ? vendorFor("IN_BENE_CREATION")(req) : orderFor(req));

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
const gateway = new CashfreeGateway(client, "sandbox");

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

console.log("\nVendor (gateway)");

const { VendorExistsError } = await import("../src/integrations/payment/provider.js");

const vendorInput = (accountType: "INDIVIDUAL" | "BUSINESS" = "INDIVIDUAL") => ({
  vendorId: "host_abc123",
  name: "Ravi Kumar!!",
  email: "ravi@gatepass.test",
  phone: "9876543210",
  bank: { accountNumber: "026291800001191", accountHolder: "RAVI KUMAR", ifsc: "YESB0000262" },
  kyc: { accountType, businessType: accountType === "BUSINESS" ? "Travel and Hospitality" : undefined, pan: "ABCPV1234D" },
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
  check("createVendor: individual KYC sends account_type + pan, no business_type", req?.body.kyc_details.account_type === "INDIVIDUAL" && req.body.kyc_details.pan === "ABCPV1234D" && !("business_type" in req.body.kyc_details));
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
  const profile = await prisma.hostProfile.create({ data: { userId: host.id, verificationStatus: "ACTIVE", payoutKycStatus: "ACTIVATED" } });
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
  check("order expires with the hold", sent?.order_expiry_time === booking.holdExpiresAt?.toISOString());
  check("idempotency key is the payment row's id", seen[0]?.headers["x-idempotency-key"] === row?.id);
  check("customer: 10-digit phone, alphanumeric id", sent?.customer_details.customer_phone === phone.slice(3) && sent.customer_details.customer_id === driver.id.replace(/-/g, ""));
  check("tags carry ids only", sent?.order_tags.booking_id === booking.id && sent.order_tags.listing_id === spot.id && Object.keys(sent.order_tags).length === 2);

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

  // History: no gateway ids.
  const history = await paymentService.listForDriver(driver.id);
  const keys = new Set(history.flatMap((p) => Object.keys(p)));
  check("GET /payments rows carry no gateway ids or session", history.length === 2 && ![...keys].some((k) => k.startsWith("gateway") || k === "provider"), [...keys]);

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
    await prisma.payment.deleteMany({ where: { booking: { listingId: id } } });
    await prisma.booking.deleteMany({ where: { listingId: id } });
    await prisma.listing.deleteMany({ where: { id } });
  }
  await prisma.hostProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
  server.close();
}

console.log(failures ? `\n${failures} failed` : "\nAll passed");
process.exit(failures ? 1 : 0);
