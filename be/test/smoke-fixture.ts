/**
 * Data for clicking through the app by hand: a driver and a host with a stay
 * in every state, so each screen has something to show.
 *
 *   npm run dev              # the API from source, in another terminal
 *   npm run test:fixture
 *   cd ../fe && npm run web
 *
 * Then sign in with the email code (SHOW_OTP_IN_RESPONSE=true puts it on the
 * screen) as smoke-driver@gatepass.test or smoke-host@gatepass.test. The ids
 * and screens it prints are what to open.
 *
 * The driver gets, on the host's spot: a paid 2-hour stay tomorrow, a paid
 * 3-day stay, one running now, one finished and not yet rated, one cancelled
 * with its refund, and an unpaid hold (which lapses 15 minutes after the run).
 * The host also gets a draft spot for the listing wizard.
 *
 * Needs what `npm run test:api` needs: the console email provider with codes
 * in responses, and this DATABASE_URL the same database as the API's.
 * Re-running resets the two accounts' spots and stays; nothing else is
 * touched.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";

const API_URL = (process.env.API_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");

const DRIVER_EMAIL = "smoke-driver@gatepass.test";
const HOST_EMAIL = "smoke-host@gatepass.test";
/** Fixed, so a re-run replaces it. */
const SPOT_ID = "50e00000-0000-4000-8000-000000000001";
const CENTRE = { latitude: 26.5452, longitude: 80.4851 };

const HOUR = 60 * 60_000;
const IST_OFFSET = 5.5 * HOUR;

async function call(method: string, path: string, token?: string, body?: unknown): Promise<any> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await response.json().catch(() => null);
    const wait = /Try again in (\d+)s/.exec(json?.error ?? "");
    if (response.status === 429 && wait && attempt < 2) {
      console.log(`(rate limit: waiting ${wait[1]}s)`);
      await new Promise((resolve) => setTimeout(resolve, (Number(wait[1]) + 1) * 1000));
      continue;
    }
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(json)}`);
    return json;
  }
}

/** Signs up the first time, signs in after: the same two calls either way. */
async function signIn(email: string, firstName: string, lastName: string): Promise<{ id: string; token: string }> {
  const deviceId = `smoke-fixture-${firstName.toLowerCase()}`;
  const { code } = await call("POST", "/auth/request-code", undefined, { email, deviceId, firstName, lastName });
  if (!code) throw new Error("No code in the response: run the API with EMAIL_PROVIDER=console and SHOW_OTP_IN_RESPONSE=true");
  const { token } = await call("POST", "/auth/verify-code", undefined, { email, code, deviceId });
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error(`The API signed in ${email} but this DATABASE_URL can't see it: a different database`);
  return { id: user.id, token };
}

/** `hour` o'clock, venue (IST) time, `days` from today. */
function istAt(days: number, hour: number): Date {
  const ist = new Date(Date.now() + IST_OFFSET);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + days, hour) - IST_OFFSET);
}

async function removeSpots(hostProfileId: string): Promise<void> {
  const spots = await prisma.listing.findMany({ where: { hostProfileId }, select: { id: true } });
  const ids = spots.map((spot) => spot.id);
  const bookings = { booking: { listingId: { in: ids } } };
  await prisma.review.deleteMany({ where: { listingId: { in: ids } } });
  await prisma.problemReport.deleteMany({ where: { listingId: { in: ids } } });
  await prisma.refund.deleteMany({ where: bookings });
  await prisma.payment.deleteMany({ where: bookings });
  await prisma.settlementItem.deleteMany({ where: bookings });
  await prisma.booking.deleteMany({ where: { listingId: { in: ids }, extendsBookingId: { not: null } } });
  await prisma.booking.deleteMany({ where: { listingId: { in: ids } } });
  await prisma.listing.deleteMany({ where: { id: { in: ids } } });
}

async function main(): Promise<void> {
  const driver = await signIn(DRIVER_EMAIL, "Smoke", "Driver");
  const host = await signIn(HOST_EMAIL, "Smoke", "Host");

  const profile = await prisma.hostProfile.upsert({
    where: { userId: host.id },
    update: { verificationStatus: "ACTIVE", payoutKycStatus: "ACTIVATED" },
    create: { userId: host.id, verificationStatus: "ACTIVE", payoutKycStatus: "ACTIVATED" },
  });
  await removeSpots(profile.id);
  await prisma.notification.deleteMany({ where: { userId: { in: [driver.id, host.id] } } });

  const now = new Date();
  await prisma.listing.create({
    data: {
      id: SPOT_ID,
      hostProfileId: profile.id,
      listingType: "INDEPENDENT_SPOT",
      status: "PUBLISHED",
      name: "Smoke test driveway",
      venueName: "Smoke test driveway",
      spaceType: "DRIVEWAY",
      addressLine: "House 3, test lane, Bara Chauraha",
      city: "Unnao",
      state: "Uttar Pradesh",
      pincode: "209801",
      latitude: CENTRE.latitude,
      longitude: CENTRE.longitude,
      vehicleTypes: ["CAR", "BIKE"],
      amenities: ["CCTV", "WELL_LIT"],
      accessInstructions: "Green gate. The latch lifts from inside.",
      entryPoint: "Green gate on the test lane",
      warrantyAcceptedAt: now,
      submittedAt: now,
      docApprovedAt: now,
      reviewedAt: now,
      createdBy: host.id,
      updatedBy: host.id,
      pricing: {
        create: [
          { vehicleType: "CAR", pricePerHour: 30, pricePerDay: 200 },
          { vehicleType: "BIKE", pricePerHour: 10, pricePerDay: 60 },
        ],
      },
      availability: {
        create: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 24 * 60 })),
      },
    },
  });

  // Booked through the API for the real price and fields, then paid and, for
  // the stays that are running or over, moved: the API refuses the past.
  const book = async (startsAt: Date, endsAt: Date) =>
    (
      await call("POST", "/spot-bookings", driver.token, {
        listingId: SPOT_ID,
        vehicleType: "CAR",
        vehicleNumber: "UP35AB1234",
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        idempotencyKey: randomUUID(),
      })
    ).id as string;

  const pay = async (id: string, times?: { startsAt: Date; endsAt: Date }) => {
    const booking = await prisma.booking.update({
      where: { id },
      data: { status: "CONFIRMED", holdExpiresAt: null, ...times },
    });
    await prisma.payment.create({
      data: { bookingId: id, amount: booking.amount.add(booking.platformFee).add(booking.taxAmount), status: "CAPTURED" },
    });
  };

  const upcoming = await book(istAt(1, 10), istAt(1, 12));
  await pay(upcoming);

  const threeDay = await book(istAt(3, 9), istAt(6, 9));
  await pay(threeDay);

  const running = await book(istAt(20, 10), istAt(20, 12));
  await pay(running, { startsAt: new Date(Date.now() - 30 * 60_000), endsAt: new Date(Date.now() + 90 * 60_000) });

  const finished = await book(istAt(21, 10), istAt(21, 12));
  await pay(finished, { startsAt: new Date(Date.now() - 26 * HOUR), endsAt: new Date(Date.now() - 24 * HOUR) });

  const cancelled = await book(istAt(22, 10), istAt(22, 12));
  await pay(cancelled);
  await call("POST", `/bookings/${cancelled}/cancel`, driver.token, { reason: "Plans changed" });

  const hold = await book(istAt(8, 18), istAt(8, 20));

  const draft = await call("POST", "/host/spots", host.token, {
    name: "Smoke test draft",
    venueName: "Smoke test draft",
    spaceType: "GARAGE",
  });

  const from = encodeURIComponent(istAt(1, 14).toISOString());
  const to = encodeURIComponent(istAt(1, 16).toISOString());
  const screens: [string, string][] = [
    [`/booking/${upcoming}`, "paid, tomorrow 10-12; also /cancel, /problem, /confirmed and /pass/:id"],
    [`/booking/${threeDay}`, "paid, 3 days"],
    [`/booking/${running}`, "running; also /extend, /report and /parking"],
    [`/booking/${finished}`, "finished, not rated; also /review"],
    [`/booking/${cancelled}`, "cancelled, refunded"],
    [`/booking/${hold}`, "unpaid hold"],
    [`/spots/${SPOT_ID}`, "the spot; also /spots/reviews?id=:id"],
    [`/spots/checkout?id=${SPOT_ID}&from=${from}&to=${to}`, "checkout, tomorrow 2-4"],
    [`/host/listing/${SPOT_ID}`, "the host's live spot; also /calendar"],
    [`/host/spot/type?id=${draft.id}`, "the host's draft, through /host/spot/review"],
  ];
  console.log(`Sign in as ${DRIVER_EMAIL} or ${HOST_EMAIL}. Screens:\n`);
  for (const [path, what] of screens) console.log(`  ${what}\n    ${path}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
