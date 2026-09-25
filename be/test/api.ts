/**
 * API checks for hourly and daily parking, run against a live API.
 *
 *   npm run dev          # the API from source, in another terminal
 *   npm run test:api
 *
 * Needs EMAIL_PROVIDER=console and SHOW_OTP_IN_RESPONSE=true (the sign-up
 * reads the code off the response), and this process's DATABASE_URL pointing
 * at the same database as the API: payments are front-end only, so paid,
 * running and finished stays are set directly in the database. API_URL
 * overrides the default http://127.0.0.1:3000.
 *
 * Each run signs up its own driver and host and gives the host a spot of its
 * own, so it never collides with a previous run or with anything else in the
 * database. Everything it created is deleted at the end; KEEP_TEST_DATA=1
 * leaves it there to look at.
 *
 * A stale API process answers every check with the code it started with --
 * restart `npm run dev` after changing the API.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";

const API_URL = (process.env.API_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const RUN = Date.now().toString(36);

/** Near the seeded spots (Bara Chauraha, Unnao), so a search there finds this one too. */
const CENTRE = { latitude: 26.5447, longitude: 80.4846 };
const RATE = { hour: 30, day: 200 };

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

// ---- harness ----

interface Res {
  status: number;
  body: any;
}

async function call(method: string, path: string, options: { token?: string; body?: unknown } = {}): Promise<Res> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON; keep the text for the failure message.
  }
  return { status: response.status, body };
}

/**
 * The auth routes allow 10 calls a minute per IP and a run makes six, so a
 * run straight after another waits out the limit instead of failing on it.
 */
async function callAuth(path: string, body: unknown): Promise<Res> {
  for (let attempt = 0; ; attempt += 1) {
    const res = await call("POST", path, { body });
    const wait = /Try again in (\d+)s/.exec(res.body?.error ?? "");
    if (res.status !== 429 || !wait || attempt === 2) return res;
    console.log(`  (auth rate limit: waiting ${wait[1]}s)`);
    await new Promise((resolve) => setTimeout(resolve, (Number(wait[1]) + 1) * 1000));
  }
}

const failures: string[] = [];
let passed = 0;

async function check(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${detail}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectStatus(res: Res, ...codes: number[]): void {
  if (!codes.includes(res.status)) {
    throw new Error(`expected ${codes.join(" or ")}, got ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`);
  }
}

/** A value an earlier check was meant to produce. */
function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`skipped: ${what} was not created`);
  return value;
}

/**
 * Every key or string that speaks of monthly parking: `pricePerMonth`,
 * `monthlyReservationId`, a term in `months`, "per month". Not the host's
 * `month` -- that is this calendar month's earnings -- and not `days` or a
 * date string.
 */
function monthlyHits(value: unknown, path = "$"): string[] {
  if (typeof value === "string") {
    return /monthly|per month/i.test(value) ? [`${path} = ${JSON.stringify(value)}`] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item, i) => monthlyHits(item, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => [
      ...(/monthly|per_?month|^months$/i.test(key) ? [`${path}.${key}`] : []),
      ...monthlyHits(item, `${path}.${key}`),
    ]);
  }
  return [];
}

function expectNoMonthly(res: Res): void {
  const hits = monthlyHits(res.body);
  expect(hits.length === 0, `response mentions monthly: ${hits.slice(0, 5).join(", ")}`);
}

/** Decimal fields come back as strings; compare them as numbers. */
function expectAmount(actual: unknown, expected: number, what: string): void {
  expect(Number(actual) === expected, `${what}: expected ${expected}, got ${JSON.stringify(actual)}`);
}

// ---- fixtures ----

interface TestUser {
  id: string;
  email: string;
  token: string;
}

const created = { userIds: [] as string[], emails: [] as string[], listingId: undefined as string | undefined };

async function signUp(role: string): Promise<TestUser> {
  const email = `api-test-${RUN}-${role}@gatepass.test`;
  const deviceId = `api-test-${RUN}-${role}`;
  created.emails.push(email);

  const requested = await callAuth("/auth/request-code", { email, deviceId, firstName: "Test", lastName: role });
  expectStatus(requested, 200);
  expect(
    typeof requested.body.code === "string",
    "no code in the response: run the API with EMAIL_PROVIDER=console and SHOW_OTP_IN_RESPONSE=true"
  );

  const verified = await callAuth("/auth/verify-code", { email, code: requested.body.code, deviceId });
  expectStatus(verified, 200);

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  expect(
    user,
    `the API signed up ${email} but this process can't see it: DATABASE_URL here and the API's are different databases`
  );
  created.userIds.push(user.id);

  return { id: user.id, email, token: verified.body.token };
}

/** A live spot of the host's own: car only, hourly and daily, open all day every day. */
async function createSpot(hostId: string): Promise<string> {
  const now = new Date();
  const profile = await prisma.hostProfile.create({
    data: { userId: hostId, verificationStatus: "ACTIVE", payoutKycStatus: "ACTIVATED" },
  });
  const spot = await prisma.listing.create({
    data: {
      hostProfileId: profile.id,
      listingType: "INDEPENDENT_SPOT",
      status: "PUBLISHED",
      name: `API test spot ${RUN}`,
      venueName: `API test spot ${RUN}`,
      spaceType: "DRIVEWAY",
      addressLine: "Test lane",
      city: "Unnao",
      state: "Uttar Pradesh",
      pincode: "209801",
      latitude: CENTRE.latitude,
      longitude: CENTRE.longitude,
      vehicleTypes: ["CAR"],
      amenities: ["CCTV"],
      accessInstructions: "Test access instructions",
      entryPoint: "Test gate",
      warrantyAcceptedAt: now,
      submittedAt: now,
      docApprovedAt: now,
      reviewedAt: now,
      createdBy: hostId,
      updatedBy: hostId,
      pricing: { create: [{ vehicleType: "CAR", pricePerHour: RATE.hour, pricePerDay: RATE.day }] },
      availability: {
        create: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 24 * 60 })),
      },
    },
  });
  created.listingId = spot.id;
  return spot.id;
}

/**
 * What the payment integration will do on success: the booking CONFIRMED and
 * its payment CAPTURED for the whole charge. `times` moves the stay, so it
 * can be running now or already over -- the API refuses to book the past.
 */
async function markPaid(bookingId: string, times?: { startsAt: Date; endsAt: Date }): Promise<void> {
  const booking = await prisma.booking.update({
    where: { id: bookingId },
    data: { status: "CONFIRMED", holdExpiresAt: null, ...times },
  });
  await prisma.payment.create({
    data: {
      bookingId,
      amount: booking.amount.add(booking.platformFee).add(booking.taxAmount),
      status: "CAPTURED",
    },
  });
}

async function cleanUp(): Promise<void> {
  const listingId = created.listingId;
  if (listingId) {
    const bookings = { booking: { listingId } };
    await prisma.review.deleteMany({ where: { listingId } });
    await prisma.problemReport.deleteMany({ where: { listingId } });
    await prisma.refund.deleteMany({ where: bookings });
    await prisma.payment.deleteMany({ where: bookings });
    await prisma.settlementItem.deleteMany({ where: bookings });
    await prisma.booking.deleteMany({ where: { listingId, extendsBookingId: { not: null } } });
    await prisma.booking.deleteMany({ where: { listingId } });
    // Pricing, hours, photos, favourites and blocks go with it.
    await prisma.listing.delete({ where: { id: listingId } });
  }
  await prisma.emailVerification.deleteMany({ where: { email: { in: created.emails } } });
  // Sessions, notifications, preferences and the host profile go with them.
  await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
}

// ---- the checks ----

async function main(): Promise<void> {
  console.log(`API checks against ${API_URL} (run ${RUN})`);

  const health = await call("GET", "/health").catch((error: unknown) => {
    throw new Error(`${API_URL} is not answering (${String(error)}). Start the API: npm run dev`);
  });
  expectStatus(health, 200);

  const driver = await signUp("driver");
  const other = await signUp("other");
  const host = await signUp("host");
  const spotId = await createSpot(host.id);

  const d = { token: driver.token };
  const h = { token: host.token };

  // Clear of each other, and far enough ahead to be cancellable for free.
  const base = new Date(Math.ceil(Date.now() / HOUR) * HOUR + 3 * DAY);
  const at = (offset: number) => new Date(base.getTime() + offset);

  const book = (user: TestUser, startsAt: Date, endsAt: Date) =>
    call("POST", "/spot-bookings", {
      token: user.token,
      body: {
        listingId: spotId,
        vehicleType: "CAR",
        vehicleNumber: "UP35AB1234",
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        idempotencyKey: randomUUID(),
      },
    });

  section("Monthly routes are gone");
  const someId = randomUUID();
  for (const [method, path] of [
    ["GET", "/monthly-reservations"],
    ["POST", "/monthly-reservations"],
    ["GET", `/monthly-reservations/${someId}`],
    ["GET", `/monthly-reservations/${someId}/cancellation`],
    ["POST", `/monthly-reservations/${someId}/cancel`],
    ["GET", `/spots/${spotId}/monthly-quote?vehicleType=CAR`],
  ] as const) {
    await check(`${method} ${path.replace(someId, ":id").replace(spotId, ":id")} is 404`, async () => {
      expectStatus(await call(method, path, { ...d, body: method === "POST" ? {} : undefined }), 404);
    });
  }

  section("Search, spot detail and quotes");
  for (const minutes of [120, 24 * 60, 3 * 24 * 60]) {
    await check(`search for ${minutes / 60} h finds the spot, with no monthly fields`, async () => {
      const res = await call(
        "GET",
        `/spots/nearby?latitude=${CENTRE.latitude}&longitude=${CENTRE.longitude}&durationMinutes=${minutes}&at=${base.toISOString()}&vehicleType=CAR`,
        d
      );
      expectStatus(res, 200);
      const items: any[] = Array.isArray(res.body) ? res.body : res.body.items ?? res.body.spots ?? [];
      expect(items.some((spot) => spot.id === spotId), "the test spot is not in the results");
      expectNoMonthly(res);
    });
  }

  await check("spot detail has hourly and daily rates and no monthly fields", async () => {
    const res = await call("GET", `/spots/${spotId}`, d);
    expectStatus(res, 200);
    expectNoMonthly(res);
    const text = JSON.stringify(res.body);
    expect(text.includes("pricePerHour") && text.includes("pricePerDay"), "no pricePerHour/pricePerDay in the detail");
  });

  for (const [label, minutes, amount, basis] of [
    ["2 h", 2 * 60, 2 * RATE.hour, "HOURLY"],
    ["1 day", 24 * 60, RATE.day, "DAILY"],
    ["3 days", 3 * 24 * 60, 3 * RATE.day, "DAILY"],
  ] as const) {
    await check(`quote for ${label} is ₹${amount} ${basis.toLowerCase()}`, async () => {
      const res = await call(
        "GET",
        `/spots/${spotId}/quote?vehicleType=CAR&startsAt=${base.toISOString()}&endsAt=${at(minutes * 60_000).toISOString()}`,
        d
      );
      expectStatus(res, 200);
      expectNoMonthly(res);
      expect(res.body.available === true, `not available: ${res.body.reason}`);
      expect(res.body.basis === basis, `basis ${res.body.basis}`);
      expectAmount(res.body.parking, amount, "parking");
    });
  }

  section("Host pricing");
  await check("pricing with pricePerMonth is 400", async () => {
    const res = await call("PATCH", `/host/spots/${spotId}/pricing`, {
      ...h,
      body: { rates: [{ vehicleType: "CAR", pricePerHour: RATE.hour, pricePerDay: RATE.day, pricePerMonth: 3000 }] },
    });
    expectStatus(res, 400);
  });
  await check("pricing with hourly and daily is 200", async () => {
    const res = await call("PATCH", `/host/spots/${spotId}/pricing`, {
      ...h,
      body: { rates: [{ vehicleType: "CAR", pricePerHour: RATE.hour, pricePerDay: RATE.day }] },
    });
    expectStatus(res, 200);
    expectNoMonthly(res);
  });

  section("Booking");
  let hourlyId: string | undefined;
  await check("2-hour booking is 201 at the hourly rate", async () => {
    const res = await book(driver, at(0), at(2 * HOUR));
    expectStatus(res, 201);
    expectAmount(res.body.amount, 2 * RATE.hour, "amount");
    expect(res.body.status === "PENDING", `status ${res.body.status}`);
    hourlyId = res.body.id;
  });

  await check("1-day booking is 201 at the daily rate", async () => {
    const res = await book(driver, at(4 * HOUR), at(4 * HOUR + DAY));
    expectStatus(res, 201);
    expectAmount(res.body.amount, RATE.day, "amount");
  });

  await check("3-day booking is 201 at three daily rates", async () => {
    const res = await book(driver, at(2 * DAY), at(5 * DAY));
    expectStatus(res, 201);
    expectAmount(res.body.amount, 3 * RATE.day, "amount");
  });

  await check("a booking overlapping the 2-hour one is 409", async () => {
    need(hourlyId, "the 2-hour booking");
    expectStatus(await book(other, at(HOUR), at(3 * HOUR)), 409);
  });

  await check("a booking overlapping the 3-day one is 409", async () => {
    expectStatus(await book(other, at(3 * DAY), at(3 * DAY + 2 * HOUR)), 409);
  });

  await check("driver's bookings list has them, with no monthly fields", async () => {
    const res = await call("GET", "/bookings?scope=upcoming", d);
    expectStatus(res, 200);
    expectNoMonthly(res);
    expect(JSON.stringify(res.body).includes(need(hourlyId, "the 2-hour booking")), "the 2-hour booking is not listed");
  });

  section("Cancel with refund");
  let cancelId: string | undefined;
  await check("a paid booking quotes a full refund", async () => {
    const res = await book(driver, at(10 * DAY), at(10 * DAY + 2 * HOUR));
    expectStatus(res, 201);
    cancelId = res.body.id as string;
    await markPaid(cancelId);
    const paid = 2 * RATE.hour + Number(res.body.platformFee) + Number(res.body.taxAmount);

    const quote = await call("GET", `/bookings/${cancelId}/cancellation`, d);
    expectStatus(quote, 200);
    expect(quote.body.cancellable === true, `not cancellable: ${quote.body.reason}`);
    expect(quote.body.rule === "FULL", `rule ${quote.body.rule}`);
    expectAmount(quote.body.refundAmount, paid, "refundAmount");
  });

  await check("cancelling it is 200 and opens the refund", async () => {
    const id = need(cancelId, "the paid booking");
    const res = await call("POST", `/bookings/${id}/cancel`, { ...d, body: { reason: "Plans changed" } });
    expectStatus(res, 200);
    expect(res.body.status === "CANCELLED", `status ${res.body.status}`);
    expect(res.body.refund?.status === "REFUND_PENDING", `refund ${JSON.stringify(res.body.refund)}`);
    const payment = await prisma.payment.findUnique({ where: { bookingId: id } });
    expectAmount(res.body.refund.amount, Number(payment!.amount), "refund amount");
  });

  section("Review a completed, paid stay");
  let finishedId: string | undefined;
  await check("review is 201", async () => {
    const res = await book(driver, at(12 * DAY), at(12 * DAY + 2 * HOUR));
    expectStatus(res, 201);
    finishedId = res.body.id as string;
    await markPaid(finishedId, { startsAt: new Date(Date.now() - 5 * HOUR), endsAt: new Date(Date.now() - 3 * HOUR) });

    const before = await call("GET", `/bookings/${finishedId}`, d);
    expectStatus(before, 200);
    expect(before.body.canReview === true, `canReview ${before.body.canReview}, phase ${before.body.phase}`);

    const review = await call("POST", `/bookings/${finishedId}/review`, {
      ...d,
      body: { rating: 5, easyToFind: 4, comment: "Easy to find, gate was open." },
    });
    expectStatus(review, 201);
  });

  await check("a second review of the same stay is 409", async () => {
    const id = need(finishedId, "the finished booking");
    expectStatus(await call("POST", `/bookings/${id}/review`, { ...d, body: { rating: 4 } }), 409);
  });

  await check("the spot's reviews list it", async () => {
    const res = await call("GET", `/spots/${spotId}/reviews`, d);
    expectStatus(res, 200);
    expect(JSON.stringify(res.body).includes("Easy to find, gate was open."), "review not listed");
  });

  section("Extend a running stay");
  let runningId: string | undefined;
  await check("extension options are offered", async () => {
    const res = await book(driver, at(14 * DAY), at(14 * DAY + 2 * HOUR));
    expectStatus(res, 201);
    runningId = res.body.id as string;
    await markPaid(runningId, { startsAt: new Date(Date.now() - 30 * 60_000), endsAt: new Date(Date.now() + 90 * 60_000) });

    const options = await call("GET", `/bookings/${runningId}/extensions`, d);
    expectStatus(options, 200);
    const first = options.body.options?.[0];
    expect(first?.available === true, `first option not available: ${JSON.stringify(first)}`);
    expectAmount(first.amount, (RATE.hour * first.minutes) / 60, "30-minute price");
  });

  await check("extending by 30 minutes is 201 and holds the extra time", async () => {
    const id = need(runningId, "the running booking");
    const res = await call("POST", `/bookings/${id}/extensions`, {
      ...d,
      body: { minutes: 30, idempotencyKey: randomUUID() },
    });
    expectStatus(res, 201);
    const extension = res.body.booking.extensions.find((e: any) => e.id === res.body.extensionId);
    expect(extension?.status === "PENDING", `extension ${JSON.stringify(extension)}`);
  });

  section("Host side");
  const today = new Date().toISOString().slice(0, 10);
  const hostGets: [string, string][] = [
    ["summary", "/host/summary"],
    ["bookings (upcoming)", `/host/bookings?listingId=${spotId}&scope=upcoming`],
    ["bookings (active)", "/host/bookings?scope=active"],
    ["bookings (completed)", "/host/bookings?scope=completed"],
    ["bookings (cancelled)", "/host/bookings?scope=cancelled"],
    ["spot overview", `/host/spots/${spotId}/overview`],
    ["calendar", `/host/spots/${spotId}/calendar?from=${today}&days=14`],
    ["earnings", "/host/earnings"],
    ["spots", "/host/spots"],
    ["spot", `/host/spots/${spotId}`],
  ];
  for (const [label, path] of hostGets) {
    await check(`${label} is 200 with no monthly fields`, async () => {
      const res = await call("GET", path, h);
      expectStatus(res, 200);
      expectNoMonthly(res);
    });
  }

  // The host sees paid stays only, so the unpaid holds stay out of every tab.
  for (const [scope, id, what] of [
    ["active", runningId, "the running booking"],
    ["completed", finishedId, "the finished booking"],
    ["cancelled", cancelId, "the cancelled booking"],
  ] as const) {
    await check(`host's ${scope} bookings list ${what}`, async () => {
      const res = await call("GET", `/host/bookings?listingId=${spotId}&scope=${scope}`, h);
      expectStatus(res, 200);
      const ids = (res.body.items as any[]).map((item) => item.id);
      expect(ids.includes(need(id, what)), `not listed: ${JSON.stringify(ids)}`);
    });
  }

  await check("host's upcoming bookings leave out unpaid holds", async () => {
    const res = await call("GET", `/host/bookings?listingId=${spotId}&scope=upcoming`, h);
    expectStatus(res, 200);
    expect(!JSON.stringify(res.body).includes(need(hourlyId, "the 2-hour booking")), "an unpaid hold is listed");
  });

  await check("earnings list the finished stay, less commission", async () => {
    const res = await call("GET", "/host/earnings", h);
    expectStatus(res, 200);
    const id = need(finishedId, "the finished booking");
    const row = (res.body.transactions as any[]).find((t) => t.id === id);
    expect(row, "the finished stay is not in the transactions");
    expectAmount(row.amount, 2 * RATE.hour * (1 - res.body.commissionRate), "earning");
  });

  await check("blocking free hours is 201 and removing the block is 200", async () => {
    const res = await call("POST", `/host/spots/${spotId}/blocks`, {
      ...h,
      body: { kind: "range", startsAt: at(20 * DAY).toISOString(), endsAt: at(20 * DAY + 3 * HOUR).toISOString(), reason: "Family visiting" },
    });
    expectStatus(res, 201);
    const blockId = res.body.blocks?.[0]?.id;
    expect(blockId, "no block id");
    expectStatus(await call("DELETE", `/host/spots/${spotId}/blocks/${blockId}`, h), 200);
  });

  await check("blocking hours that are booked is 409", async () => {
    const res = await call("POST", `/host/spots/${spotId}/blocks`, {
      ...h,
      body: { kind: "range", startsAt: at(0).toISOString(), endsAt: at(HOUR).toISOString() },
    });
    expectStatus(res, 409);
  });

  await check("blocking a day's free hours around a booking is 201", async () => {
    expectStatus(await book(driver, at(22 * DAY), at(22 * DAY + 2 * HOUR)), 201);
    // The venue's (IST) date of that booking.
    const date = new Date(at(22 * DAY).getTime() + 5.5 * HOUR).toISOString().slice(0, 10);
    const res = await call("POST", `/host/spots/${spotId}/blocks`, { ...h, body: { kind: "day", date, freeOnly: true } });
    expectStatus(res, 201);
    expect(res.body.blocks?.length >= 1, `blocks ${JSON.stringify(res.body.blocks)}`);
  });

  section("Notifications");
  await check("driver's notifications are 200 with no monthly kinds", async () => {
    const res = await call("GET", "/notifications", d);
    expectStatus(res, 200);
    expectNoMonthly(res);
  });
}

main()
  .catch((error) => {
    console.error(`\nStopped: ${error instanceof Error ? error.message : String(error)}`);
    failures.push("setup");
  })
  .finally(async () => {
    if (process.env.KEEP_TEST_DATA === "1") {
      console.log(`\nKept the test data (run ${RUN}).`);
    } else {
      await cleanUp().catch((error) => console.error(`\nCleanup failed: ${String(error)}`));
    }
    await prisma.$disconnect();
    console.log(`\n${passed} passed, ${failures.length} failed`);
    process.exitCode = failures.length > 0 ? 1 : 0;
  });
