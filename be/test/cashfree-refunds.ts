/**
 * Cashfree refunds, checked against a fake Cashfree on localhost.
 *
 *   npm run test:refunds
 *
 * Runs the refund flow in-process against the dev database (DATABASE_URL):
 * cancellation -> Refund row -> Create Refund -> webhook / Get Refund ->
 * REFUNDED or FAILED -> admin retry. The fake plays Cashfree and records what
 * was sent. Everything this creates is deleted at the end.
 */
import "dotenv/config";
import { createHmac } from "node:crypto";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

process.env.PAYMENT_PROVIDER = "cashfree";
process.env.CASHFREE_ENV = "sandbox";
process.env.CASHFREE_CLIENT_ID = "test-client-id";
process.env.CASHFREE_CLIENT_SECRET = "test-secret-must-never-leak";
process.env.CASHFREE_API_VERSION = "2026-01-01";
process.env.INTEGRATION_MAX_RETRIES = "2";
process.env.INTEGRATION_TIMEOUT_MS = "2000";

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

/** Refunds the fake "has", by refund_id: what Get Refund answers. */
const refunds = new Map<string, { order_id: string; refund_id: string; refund_amount: number; refund_status: string; cf_refund_id: string }>();
/** Payment attempts per order, for Get Payments. */
const payments = new Map<string, { status: string; amount: number }[]>();
/** The status the next created refund starts in (Cashfree answers PENDING in practice). */
let createAs = "PENDING";

const refundEntity = (r: { order_id: string; refund_id: string; refund_amount: number; refund_status: string; cf_refund_id: string }) => ({
  cf_payment_id: "1457662411918550528",
  cf_refund_id: r.cf_refund_id,
  refund_id: r.refund_id,
  order_id: r.order_id,
  entity: "refund",
  refund_amount: r.refund_amount,
  refund_currency: "INR",
  refund_status: r.refund_status,
  refund_arn: r.refund_status === "SUCCESS" ? "ARN205907014017" : null,
  status_description: r.refund_status === "CANCELLED" ? "Refund cancelled by bank" : "In Progress",
  processed_at: r.refund_status === "SUCCESS" ? "2026-10-01T13:04:27+05:30" : null,
  refund_splits: [],
  refund_type: "MERCHANT_INITIATED",
});

const createRefund = (req: Seen) => {
  const orderId = decodeURIComponent(req.url.split("/")[2]!);
  if (refunds.has(req.body.refund_id)) {
    return { status: 409, body: { message: "refund with this refund_id already exists", code: "refund_already_exists", type: "invalid_request_error" } };
  }
  const r = { order_id: orderId, refund_id: req.body.refund_id, refund_amount: req.body.refund_amount, refund_status: createAs, cf_refund_id: String(1553338 + refunds.size) };
  refunds.set(r.refund_id, r);
  return { status: 200, body: refundEntity(r) };
};

const byDefault = (req: Seen) => {
  if (req.method === "POST" && /^\/orders\/[^/]+\/refunds$/.test(req.url)) return createRefund(req);
  const one = req.url.match(/^\/orders\/([^/]+)\/refunds\/([^/]+)$/);
  if (req.method === "GET" && one) {
    const r = refunds.get(decodeURIComponent(one[2]!));
    return r ? { status: 200, body: refundEntity(r) } : { status: 404, body: { message: "refund does not exist", code: "refund_not_found", type: "invalid_request_error" } };
  }
  const pays = req.url.match(/^\/orders\/([^/]+)\/payments$/);
  if (req.method === "GET" && pays) {
    const orderId = decodeURIComponent(pays[1]!);
    return {
      status: 200,
      body: (payments.get(orderId) ?? []).map((p, i) => ({
        cf_payment_id: `14576624119185505${String(i).padStart(2, "0")}`,
        order_id: orderId,
        payment_amount: p.amount,
        payment_currency: "INR",
        payment_status: p.status,
        payment_group: "upi",
        payment_completion_time: "2026-10-01T12:40:50+05:30",
      })),
    };
  }
  return { status: 404, body: { message: `fake: nothing at ${req.method} ${req.url}` } };
};

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
const refundPosts = () => seen.filter((s) => s.method === "POST" && /\/refunds$/.test(s.url));
const signed = (body: object, secret = SECRET!) => {
  const raw = JSON.stringify(body);
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", secret).update(timestamp + raw).digest("base64");
  return { raw, headers: { "x-webhook-timestamp": timestamp, "x-webhook-signature": signature, "content-type": "application/json" } };
};
const refundWebhook = (orderId: string, refundId: string, status: string) =>
  signed({ type: "REFUND_STATUS_WEBHOOK", event_time: new Date().toISOString(), data: { refund: { order_id: orderId, refund_id: refundId, refund_status: status, refund_amount: 1 } } });

const { CASHFREE_BASE_URLS } = await import("../src/integrations/payment/cashfree/client.js");
(CASHFREE_BASE_URLS as { sandbox: string }).sandbox = FAKE_URL;

const { prisma } = await import("../src/lib/prisma.js");
const cancellation = await import("../src/services/booking-cancellation.service.js");
const refundService = await import("../src/services/refund.service.js");
const hooks = await import("../src/services/gateway-webhook.service.js");
const confirm = await import("../src/services/payment-confirmation.service.js");
const bookingService = await import("../src/services/booking.service.js");

const RUN = Date.now().toString(36);
const userIds: string[] = [];
let listingId: string | null = null;

try {
  const host = await prisma.user.create({ data: { email: `rf-test-${RUN}-host@gatepass.test`, firstName: "Test", lastName: "Host" } });
  const phone = `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
  const driver = await prisma.user.create({ data: { email: `rf-test-${RUN}-driver@gatepass.test`, phone, firstName: "Test", lastName: "Driver" } });
  const admin = await prisma.user.create({ data: { email: `rf-test-${RUN}-admin@gatepass.test`, firstName: "Test", lastName: "Admin" } });
  userIds.push(host.id, driver.id, admin.id);

  const now = new Date();
  const HOST_VENDOR = `host_rftest${RUN}`;
  const profile = await prisma.hostProfile.create({ data: { userId: host.id, verificationStatus: "ACTIVE", payoutKycStatus: "ACTIVATED", payoutAccountId: HOST_VENDOR } });
  const spot = await prisma.listing.create({
    data: {
      hostProfileId: profile.id,
      listingType: "INDEPENDENT_SPOT",
      status: "PUBLISHED",
      name: `Refund test spot ${RUN}`,
      venueName: `Refund test spot ${RUN}`,
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

  const MIN = 60_000;
  let slot = 0;
  /**
   * A booking with a gateway order: paid (CONFIRMED + CAPTURED, split 90%) or
   * a hold with its order open, for two hours from `startsInMin`.
   */
  async function booking(opts: { startsInMin: number; paid: boolean }) {
    slot++;
    const startsAt = new Date(Date.now() + opts.startsInMin * MIN);
    const row = await prisma.booking.create({
      data: {
        listingId: spot.id,
        driverId: driver.id,
        vehicleNumber: "UP35AB1234",
        vehicleType: "CAR",
        quantity: 1,
        amount: 120,
        status: opts.paid ? "CONFIRMED" : "PENDING",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 2 * 60 * MIN),
        holdExpiresAt: new Date(Date.now() + 15 * MIN),
        idempotencyKey: `rf-test-${RUN}-${slot}`,
      },
      select: { id: true },
    });
    await prisma.payment.create({
      data: {
        bookingId: row.id,
        amount: 120,
        status: opts.paid ? "CAPTURED" : "CREATED",
        provider: "cashfree",
        gatewayOrderId: `bk_${row.id}`,
        splitVendorId: HOST_VENDOR,
        splitAmount: 108,
      },
    });
    return { id: row.id, orderId: `bk_${row.id}` };
  }
  // Each early case sits in a day of its own, so their hours never overlap
  // (the within-the-hour ones are cancelled before the next is placed).
  let day = 0;
  const nextDayStart = () => ++day * 24 * 60 + 5 * 60;
  const refundOf = (bookingId: string) => prisma.refund.findUnique({ where: { bookingId } });

  // ---------------------------------------------------------------- 1
  console.log("1. Paid + cancelled early: full refund");
  reset();
  const full = await booking({ startsInMin: nextDayStart(), paid: true });
  const view = await cancellation.cancel(full.id, driver.id, "Plans changed");
  const r1 = await refundOf(full.id);
  const post = refundPosts()[0];
  check("booking CANCELLED, refund row FULL 120", view.status === "CANCELLED" && r1?.policy === "FULL" && r1.amount.toNumber() === 120, r1);
  check("one Create Refund on the booking's order", refundPosts().length === 1 && post?.url === `/orders/${full.orderId}/refunds`, seen.map((s) => `${s.method} ${s.url}`));
  check("body: amount 120, STANDARD, our refund_id, a note with the booking ref", post?.body.refund_amount === 120 && post.body.refund_speed === "STANDARD" && post.body.refund_id === refundService.gatewayRefundIdFor(r1!.id, 1) && /^GatePass GP-[A-Z0-9]{6} FULL$/.test(post.body.refund_note), post?.body);
  check("refund_id is 3-40 letters and digits", /^[A-Za-z0-9]{3,40}$/.test(post?.body.refund_id ?? ""), post?.body.refund_id);
  check("refund_splits: host bears 90% (108 of 120)", post?.body.refund_splits?.length === 1 && post.body.refund_splits[0].vendor_id === HOST_VENDOR && post.body.refund_splits[0].amount === 108, post?.body.refund_splits);
  check("idempotency key is a UUID", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/.test(String(post?.headers["x-idempotency-key"])), post?.headers["x-idempotency-key"]);
  check("secret sent only in its header", post?.headers["x-client-secret"] === SECRET && !JSON.stringify(post?.body).includes(SECRET!));
  check("row: still REFUND_PENDING (accepted is not refunded), submitted, cf id stored", r1?.status === "REFUND_PENDING" && r1.submittedAt && r1.gatewayRefundRef === "1553338" && r1.splitAmount?.toNumber() === 108, r1);
  check("the app's view: amount/status/policy only, no gateway ids", view.refund && Object.keys(view.refund).sort().join(",") === "amount,createdAt,policy,processedAt,reference,status" && !JSON.stringify(view).includes(r1!.gatewayRefundId!), view.refund);

  console.log("   webhook SUCCESS, delivered twice");
  reset();
  refunds.get(r1!.gatewayRefundId!)!.refund_status = "SUCCESS";
  const hook = refundWebhook(full.orderId, r1!.gatewayRefundId!, "SUCCESS");
  const firstHook = await hooks.receiveGatewayWebhook(hook.raw, hook.headers);
  const afterHook = await refundOf(full.id);
  check("webhook -> HANDLED, status asked of Cashfree (Get Refund)", firstHook === "HANDLED" && seen.length === 1 && seen[0]!.method === "GET" && seen[0]!.url === `/orders/${full.orderId}/refunds/${r1!.gatewayRefundId}`, seen.map((s) => s.url));
  check("row REFUNDED, processedAt and bank ref stored", afterHook?.status === "REFUNDED" && afterHook.processedAt && afterHook.reference === "ARN205907014017", afterHook);
  reset();
  const secondHook = await hooks.receiveGatewayWebhook(hook.raw, hook.headers);
  const sentNotes = await prisma.notification.count({ where: { userId: driver.id, kind: "REFUND_SENT", bookingId: full.id } });
  check("duplicate webhook: HANDLED, no gateway call, nothing changes", secondHook === "HANDLED" && seen.length === 0 && (await refundOf(full.id))?.processedAt?.getTime() === afterHook?.processedAt?.getTime());
  check("driver told once: 'Refund processed'", sentNotes === 1, sentNotes);

  console.log("   webhook whose body says SUCCESS for a refund Cashfree has PENDING");
  const liar = await booking({ startsInMin: nextDayStart(), paid: true });
  await cancellation.cancel(liar.id, driver.id);
  const rl = await refundOf(liar.id);
  reset();
  const lie = refundWebhook(liar.orderId, rl!.gatewayRefundId!, "SUCCESS");
  await hooks.receiveGatewayWebhook(lie.raw, lie.headers);
  check("the body isn't trusted: still REFUND_PENDING", (await refundOf(liar.id))?.status === "REFUND_PENDING");

  console.log("   forged and unknown webhooks");
  reset();
  const forged = signed(JSON.parse(refundWebhook(liar.orderId, rl!.gatewayRefundId!, "SUCCESS").raw), "not-the-secret");
  check("forged signature -> BAD_SIGNATURE, no gateway call", (await hooks.receiveGatewayWebhook(forged.raw, forged.headers)) === "BAD_SIGNATURE" && seen.length === 0);
  const stranger = refundWebhook("bk_notours", "rfnotours", "SUCCESS");
  check("refund not ours -> IGNORED", (await hooks.receiveGatewayWebhook(stranger.raw, stranger.headers)) === "IGNORED" && seen.length === 0);

  // ---------------------------------------------------------------- 2
  console.log("2. Paid + cancelled within the hour: partial refund");
  reset();
  const late = await booking({ startsInMin: 30, paid: true });
  await cancellation.cancel(late.id, driver.id);
  const r2 = await refundOf(late.id);
  const post2 = refundPosts()[0];
  check("LATE: 50% of parking = 60", r2?.policy === "LATE" && r2.amount.toNumber() === 60, r2);
  check("split proportional: host bears 54 of 60", post2?.body.refund_amount === 60 && post2.body.refund_splits?.[0]?.amount === 54, post2?.body);

  // ---------------------------------------------------------------- 3
  console.log("3. After the stay started: no cancel, no refund");
  reset();
  const started = await booking({ startsInMin: -10 - 3 * 24 * 60, paid: true });
  const refused = await rejects(() => cancellation.cancel(started.id, driver.id));
  check("409, no refund row, Cashfree not called", refused?.statusCode === 409 && !(await refundOf(started.id)) && seen.length === 0, refused?.message);

  // ---------------------------------------------------------------- 4, 5
  for (const status of ["FAILED", "USER_DROPPED"]) {
    console.log(`${status === "FAILED" ? 4 : 5}. Hold whose payment ${status}: cancel, nothing to refund`);
    reset();
    const hold = await booking({ startsInMin: nextDayStart(), paid: false });
    payments.set(hold.orderId, [{ status, amount: 120 }]);
    const cancelled = await cancellation.cancel(hold.id, driver.id);
    check("cancelled, no refund row, no Create Refund (Cashfree asked about the payment)", cancelled.status === "CANCELLED" && !(await refundOf(hold.id)) && refundPosts().length === 0 && seen.some((s) => s.url.endsWith("/payments")), seen.map((s) => s.url));
  }

  // ---------------------------------------------------------------- 6
  console.log("6. Hold whose payment is PENDING at Cashfree");
  reset();
  const inflight = await booking({ startsInMin: 40, paid: false });
  payments.set(inflight.orderId, [{ status: "PENDING", amount: 120 }]);
  const wait = await rejects(() => cancellation.cancel(inflight.id, driver.id));
  const stillHeld = await prisma.booking.findUnique({ where: { id: inflight.id }, select: { status: true } });
  check("409 'still being processed', hold untouched, no refund", wait?.statusCode === 409 && /still being processed/.test(wait.message) && stillHeld?.status === "PENDING" && !(await refundOf(inflight.id)), wait?.message);
  reset();
  payments.set(inflight.orderId, [{ status: "SUCCESS", amount: 120 }]);
  await cancellation.cancel(inflight.id, driver.id);
  const r6 = await refundOf(inflight.id);
  check("then paid: recorded first, cancelled as paid -> LATE 60 (not a full 'cancelled before payment')", r6?.policy === "LATE" && r6.amount.toNumber() === 60 && refundPosts().length === 1, r6);

  // ---------------------------------------------------------------- 7
  console.log("7. Cancel tapped twice at once");
  reset();
  const twice = await booking({ startsInMin: nextDayStart(), paid: true });
  const both = await Promise.allSettled([cancellation.cancel(twice.id, driver.id), cancellation.cancel(twice.id, driver.id)]);
  const rows7 = await prisma.refund.count({ where: { bookingId: twice.id } });
  check("one refund row, one Create Refund", rows7 === 1 && refundPosts().length === 1, { rows7, posts: refundPosts().length, both: both.map((b) => b.status) });
  reset();
  await cancellation.cancel(twice.id, driver.id);
  check("a third cancel later: answered with the booking, nothing sent", refundPosts().length === 0);

  // ---------------------------------------------------------------- 9, poll
  console.log("9. Pending refund, no webhook: the job asks");
  reset();
  await prisma.refund.update({ where: { bookingId: liar.id }, data: { checkedAt: new Date(Date.now() - 11 * MIN) } });
  await refundService.runRefundJobs();
  check("job: Get Refund for the stale pending one, still pending", seen.some((s) => s.method === "GET" && s.url.endsWith(`/refunds/${rl!.gatewayRefundId}`)) && (await refundOf(liar.id))?.status === "REFUND_PENDING");
  reset();
  await refundService.runRefundJobs();
  check("checked a moment ago: not asked again", seen.length === 0, seen.map((s) => s.url));

  // ---------------------------------------------------------------- 11, admin retry
  console.log("11. Refund cancelled by Cashfree: FAILED, then admin retry");
  reset();
  refunds.get(rl!.gatewayRefundId!)!.refund_status = "CANCELLED";
  await prisma.refund.update({ where: { bookingId: liar.id }, data: { checkedAt: new Date(Date.now() - 11 * MIN) } });
  await refundService.runRefundJobs();
  const failed = await refundOf(liar.id);
  const failNote = await prisma.notification.count({ where: { userId: driver.id, kind: "REFUND_FAILED", bookingId: liar.id } });
  check("FAILED with Cashfree's reason, driver told", failed?.status === "FAILED" && failed.failureReason === "Refund cancelled by bank" && failNote === 1, failed);
  reset();
  await refundService.runRefundJobs();
  check("a FAILED refund is never resent by the job", refundPosts().length === 0);
  reset();
  const retried = await refundService.retryFailedRefund(failed!.id, admin.id);
  const post11 = refundPosts()[0];
  check("admin retry: checks the old id first, then a new refund_id (a2)", seen[0]?.method === "GET" && post11?.body.refund_id === refundService.gatewayRefundIdFor(failed!.id, 2) && post11.body.refund_id.endsWith("a2") && retried.attempt === 2 && retried.status === "REFUND_PENDING", { calls: seen.map((s) => `${s.method} ${s.url}`), retried });
  check("admin view carries the trail: order, refund ids", retried.orderId === liar.orderId && retried.gatewayRefundId === post11?.body.refund_id && Boolean(retried.gatewayRefundRef));
  const notFailed = await rejects(() => refundService.retryFailedRefund(failed!.id, admin.id));
  check("retrying one that isn't FAILED -> 409", notFailed?.statusCode === 409, notFailed?.message);
  await prisma.refund.update({ where: { id: failed!.id }, data: { status: "FAILED", attempt: 3 } });
  const capped = await rejects(() => refundService.retryFailedRefund(failed!.id, admin.id));
  check("after 3 attempts -> 409, settle from the dashboard", capped?.statusCode === 409 && /3 times/.test(capped.message), capped?.message);

  console.log("   admin retry when the 'failed' attempt did reach Cashfree");
  reset();
  const ghost = await booking({ startsInMin: nextDayStart(), paid: true });
  await cancellation.cancel(ghost.id, driver.id);
  const rg = await refundOf(ghost.id);
  // Marked FAILED on our side (say, gateway unreachable), but Cashfree has it.
  await prisma.refund.update({ where: { id: rg!.id }, data: { status: "FAILED", failureReason: "Gateway unreachable" } });
  reset();
  const adopted = await refundService.retryFailedRefund(rg!.id, admin.id);
  check("adopted, not sent again: no second refund", refundPosts().length === 0 && adopted.status === "REFUND_PENDING" && adopted.attempt === 1, { adopted, calls: seen.map((s) => `${s.method} ${s.url}`) });

  // ---------------------------------------------------------------- 12, case E
  console.log("12. Cashfree takes the refund but the answer is lost");
  reset();
  const lost = await booking({ startsInMin: nextDayStart(), paid: true });
  // First send: Cashfree records it, answers 500. The client retries with the
  // same refund_id and idempotency key and gets 409 "already exists".
  script.push((req) => {
    createRefund(req);
    return { status: 500, body: { message: "internal error", code: "internal_error", type: "api_error" } };
  });
  await cancellation.cancel(lost.id, driver.id);
  const r12 = await refundOf(lost.id);
  const forOrder = [...refunds.values()].filter((r) => r.order_id === lost.orderId);
  check("exactly one refund at Cashfree for the order", forOrder.length === 1, forOrder);
  check("row adopted it: submitted with Cashfree's id", r12?.submittedAt && r12.gatewayRefundRef === forOrder[0]?.cf_refund_id, r12);

  console.log("   Cashfree down: sent again later with backoff, then FAILED after 5 tries");
  reset();
  const down = await booking({ startsInMin: nextDayStart(), paid: true });
  for (let i = 0; i < 3; i++) script.push({ status: 503, body: { message: "unavailable" } });
  const cancelledWhileDown = await cancellation.cancel(down.id, driver.id);
  const r12b = await refundOf(down.id);
  check("the cancel still succeeds; refund waits unsent (1 try)", cancelledWhileDown.status === "CANCELLED" && r12b?.status === "REFUND_PENDING" && !r12b.submittedAt && r12b.sendTries === 1, r12b);
  reset();
  await refundService.runRefundJobs();
  check("job within the backoff: not sent", refundPosts().length === 0);
  await prisma.refund.update({ where: { id: r12b!.id }, data: { checkedAt: new Date(Date.now() - 2 * MIN) } });
  reset();
  await refundService.runRefundJobs();
  check("job after the backoff: sent (same refund_id) and accepted", refundPosts()[0]?.body.refund_id === r12b!.gatewayRefundId && Boolean((await refundOf(down.id))?.submittedAt));

  const never = await booking({ startsInMin: nextDayStart(), paid: true });
  for (let i = 0; i < 3; i++) script.push({ status: 503, body: { message: "unavailable" } });
  await cancellation.cancel(never.id, driver.id);
  await prisma.refund.update({ where: { bookingId: never.id }, data: { sendTries: 4, checkedAt: new Date(Date.now() - 60 * MIN) } });
  reset();
  for (let i = 0; i < 3; i++) script.push({ status: 503, body: { message: "unavailable" } });
  await refundService.runRefundJobs();
  const r12c = await refundOf(never.id);
  check("5th try unanswered -> FAILED, waits for an admin", r12c?.status === "FAILED" && /unreachable/.test(r12c.failureReason ?? ""), r12c);

  console.log("   Cashfree refuses (4xx): FAILED at once, not retried");
  reset();
  const bad = await booking({ startsInMin: nextDayStart(), paid: true });
  script.push({ status: 400, body: { message: "refund_amount : amount exceeds the refundable amount", code: "refund_amount_invalid", type: "invalid_request_error" } });
  await cancellation.cancel(bad.id, driver.id);
  const r12d = await refundOf(bad.id);
  check("one call, FAILED with Cashfree's reason", refundPosts().length === 1 && r12d?.status === "FAILED" && /refund_amount_invalid/.test(r12d.failureReason ?? ""), r12d);

  // ---------------------------------------------------------------- 14
  console.log("14. Already refunded: nothing more sent");
  reset();
  await refundService.sendRefund(r1!.id);
  await refundService.refreshRefund(r1!.id, new Date(), 0);
  check("REFUNDED row: no Create, no Get", seen.length === 0);

  // ---------------------------------------------------------------- other sources
  console.log("Other sources: a payment that lands after the driver cancelled");
  reset();
  const quit = await booking({ startsInMin: nextDayStart(), paid: false });
  payments.set(quit.orderId, []);
  await cancellation.cancel(quit.id, driver.id);
  payments.set(quit.orderId, [{ status: "SUCCESS", amount: 120 }]);
  await prisma.payment.update({ where: { bookingId: quit.id }, data: { gatewayCheckedAt: null } });
  reset();
  const outcomeNote = await confirm.onOrderNotice(quit.orderId, "PAYMENT_SUCCESS_WEBHOOK");
  const rq = await refundOf(quit.id);
  check("CANCELLED_BEFORE_PAYMENT refund opened and sent to Cashfree in full", outcomeNote === "HANDLED" && rq?.policy === "CANCELLED_BEFORE_PAYMENT" && rq.amount.toNumber() === 120 && refundPosts().length === 1 && Boolean(rq.submittedAt), rq);

  console.log("Reading a booking checks a pending refund (throttled)");
  reset();
  const read = await booking({ startsInMin: nextDayStart(), paid: true });
  await cancellation.cancel(read.id, driver.id);
  const rr = await refundOf(read.id);
  refunds.get(rr!.gatewayRefundId!)!.refund_status = "SUCCESS";
  await prisma.refund.update({ where: { id: rr!.id }, data: { checkedAt: new Date(Date.now() - 3 * MIN) } });
  const readView = await bookingService.getForDriver(read.id, driver.id);
  check("the booking reads REFUNDED without any webhook", readView.refund?.status === "REFUNDED", readView.refund);
} finally {
  if (listingId) {
    await prisma.refund.deleteMany({ where: { booking: { listingId } } });
    await prisma.payment.deleteMany({ where: { booking: { listingId } } });
    await prisma.booking.deleteMany({ where: { listingId } });
    await prisma.listing.deleteMany({ where: { id: listingId } });
  }
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.userSettings.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.hostProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
  server.close();
}

console.log(failures ? `\n${failures} failed` : "\nAll passed");
process.exit(failures ? 1 : 0);
