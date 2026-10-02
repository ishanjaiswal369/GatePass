import { Prisma } from "@prisma/client";
import { env } from "../config/env.js";
import { hostShareOf } from "../config/pricing.js";
import { getPaymentGateway, type ClientHints, type PaymentGateway, type UpiApp } from "../integrations/payment/index.js";
import { AppError, badRequest, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/security-log.js";

/**
 * Money in: the Payment row a booking is paid through, and the gateway order
 * behind it.
 *
 * Nothing here takes an amount, an order id or a status from the caller. The
 * amount is the booking's own (its parking amount -- plus the driver fee and
 * GST columns, zero since the driver fee was dropped -- fixed when it was made), the order id is derived from the booking, and the status only ever
 * moves on the gateway's word -- the webhook, not the app.
 */

/** What the app's checkout SDK needs to open the payment. Only for the booking's own driver. */
export interface Checkout {
  provider: PaymentGateway["name"];
  environment: PaymentGateway["environment"];
  orderId: string;
  paymentSessionId: string;
  expiresAt: Date;
}

/** Our order id at the gateway: one per booking, and readable in its dashboard. */
export function gatewayOrderIdFor(bookingId: string): string {
  return `bk_${bookingId}`;
}

/** Everything the driver pays for a booking. */
export function payableTotal(booking: {
  amount: Prisma.Decimal;
  platformFee: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
}): Prisma.Decimal {
  return booking.amount.add(booking.platformFee).add(booking.taxAmount).toDecimalPlaces(2);
}

export const phoneRequired = () => {
  const error = new AppError("Add your mobile number to pay for this booking.", 409, "PHONE_REQUIRED");
  // The app reads the code to open its phone prompt rather than show the text.
  error.extra = { code: "PHONE_REQUIRED" };
  return error;
};

/** Stored as +91XXXXXXXXXX (lib/phone); the gateway wants the ten digits. */
function gatewayPhone(phone: string | null): string | null {
  const match = phone?.match(/^\+91([6-9]\d{9})$/);
  return match ? match[1]! : null;
}

/**
 * Refuses up front when a gateway is on and the booking couldn't be paid:
 * the driver has no mobile number, or the space's host has no payee at the
 * gateway to route their share to.
 *
 * Called before a booking is placed, so nobody holds hours that can't be
 * paid for. With no gateway configured there is nothing to check.
 */
export async function assertCanPay(driverId: string, listingId?: string): Promise<void> {
  if (!getPaymentGateway()) return;

  const driver = await prisma.user.findUnique({ where: { id: driverId }, select: { phone: true } });
  if (!gatewayPhone(driver?.phone ?? null)) throw phoneRequired();

  if (listingId) {
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      select: { hostProfile: { select: { payoutAccountId: true, payoutKycStatus: true } } },
    });
    // No listing: left to the booking itself, which answers 404.
    const host = listing?.hostProfile;
    if (listing && (!host?.payoutAccountId || host.payoutKycStatus !== "ACTIVATED")) {
      audit("PAYMENT_HOST_NOT_PAYABLE", { listingId, payoutKycStatus: host?.payoutKycStatus ?? null });
      throw hostNotPayable();
    }
  }
}

/**
 * Opens the Payment row, inside the transaction that places the booking.
 *
 * Same transaction, so there is never a hold without its payment row -- and
 * the row exists before the gateway is called, so a retry after a timeout
 * finds it and sends the same order id and idempotency key instead of opening
 * a second order.
 */
export async function openPaymentRow(
  tx: Prisma.TransactionClient,
  booking: { id: string; amount: Prisma.Decimal; platformFee: Prisma.Decimal; taxAmount: Prisma.Decimal },
  driverId: string
): Promise<{ status: string; amount: Prisma.Decimal } | null> {
  const gateway = getPaymentGateway();
  if (!gateway) return null;

  return tx.payment.create({
    data: {
      bookingId: booking.id,
      amount: payableTotal(booking),
      status: "CREATED",
      provider: gateway.name,
      gatewayOrderId: gatewayOrderIdFor(booking.id),
      createdBy: driverId,
      updatedBy: driverId,
    },
    select: { status: true, amount: true },
  });
}

const orderRow = {
  id: true,
  status: true,
  holdExpiresAt: true,
  listingId: true,
  amount: true,
  platformFee: true,
  taxAmount: true,
  driver: { select: { email: true, phone: true, firstName: true, lastName: true } },
  listing: { select: { hostProfile: { select: { payoutAccountId: true, payoutKycStatus: true } } } },
  payment: {
    select: {
      id: true,
      status: true,
      amount: true,
      gatewayOrderId: true,
      gatewaySessionId: true,
      gatewayExpiresAt: true,
      splitVendorId: true,
      splitAmount: true,
    },
  },
} satisfies Prisma.BookingSelect;

export const hostNotPayable = () =>
  new AppError("This space can't take payments right now. Try again later or pick another space.", 409, "HOST_NOT_PAYABLE");

/**
 * The host's part of the order, fixed on the Payment row the first time the
 * order is opened and reused on every retry.
 *
 * The order carries it (Easy Split, owner's decision 2026-09-27): the gateway
 * pays the host their share by itself, with no job of ours to run later. A
 * host with no active payee at the gateway can't be paid, so the order isn't
 * opened at all (owner's decision): GatePass never takes money it has no way
 * to pass on. Search and booking already require ACTIVATED, so this only
 * catches a host whose account changed a moment ago -- or dev data that
 * marked a host active without registering them.
 */
async function splitFor(
  booking: Prisma.BookingGetPayload<{ select: typeof orderRow }>,
  payment: { id: string; splitVendorId: string | null; splitAmount: Prisma.Decimal | null }
): Promise<{ vendorId: string; amount: Prisma.Decimal }> {
  if (payment.splitVendorId && payment.splitAmount) {
    return { vendorId: payment.splitVendorId, amount: payment.splitAmount };
  }

  const host = booking.listing?.hostProfile;
  if (!host?.payoutAccountId || host.payoutKycStatus !== "ACTIVATED") {
    audit("PAYMENT_HOST_NOT_PAYABLE", { bookingId: booking.id, listingId: booking.listingId, payoutKycStatus: host?.payoutKycStatus ?? null });
    throw hostNotPayable();
  }

  const split = { vendorId: host.payoutAccountId, amount: hostShareOf(booking.amount) };
  // Only while unset: two replays racing here settle on one split.
  await prisma.payment.updateMany({
    where: { id: payment.id, splitVendorId: null },
    data: { splitVendorId: split.vendorId, splitAmount: split.amount },
  });
  const stored = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id }, select: { splitVendorId: true, splitAmount: true } });
  return { vendorId: stored.splitVendorId!, amount: stored.splitAmount! };
}

/**
 * Cashfree refuses an order that expires 15 minutes or less from when it
 * arrives -- and a hold is exactly 15 minutes, set a moment before the order
 * is sent. Seen 2026-09-27: a 3.8 s round trip left 14:56 and the order was
 * refused ("Expiry time should be more than 15 min").
 */
const MIN_ORDER_LIFETIME_MS = 16 * 60_000;

/**
 * When the order stops taking payment: with the hold, or a little after when
 * the hold is too close for the gateway to accept. A payment in that last
 * minute lands after the hold lapsed, which payment-confirmation already
 * settles: confirmed if the hours are still free, refunded in full if not.
 */
function orderExpiry(holdExpiresAt: Date, now = Date.now()): Date {
  return new Date(Math.max(holdExpiresAt.getTime(), now + MIN_ORDER_LIFETIME_MS));
}

/**
 * The gateway order for a driver's unpaid booking, opened if it isn't yet.
 *
 * Idempotent, and safe to call on every replay of the booking request: an
 * order already open and unexpired is returned from the row without calling
 * the gateway, and one whose first attempt failed is retried with the same
 * order id and idempotency key, so the gateway hands back the same order.
 *
 * Null when there is nothing to pay: no gateway configured, or the booking is
 * no longer an unpaid, unexpired hold.
 */
export async function openOrder(bookingId: string, driverId: string): Promise<Checkout | null> {
  const gateway = getPaymentGateway();
  if (!gateway) return null;

  const now = new Date();
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, driverId },
    select: orderRow,
  });
  if (!booking) throw notFound("Booking not found");

  // Only a live hold can be paid for; an order must never outlive the hours
  // it pays for, since those go back on sale when the hold lapses.
  if (booking.status !== "PENDING" || !booking.holdExpiresAt || booking.holdExpiresAt <= now) {
    return null;
  }

  const payment = booking.payment ?? (await openLateRow(booking, driverId, gateway));
  if (payment.status !== "CREATED") return null;

  const orderId = payment.gatewayOrderId ?? gatewayOrderIdFor(booking.id);

  if (payment.gatewaySessionId && payment.gatewayExpiresAt && payment.gatewayExpiresAt > now) {
    return {
      provider: gateway.name,
      environment: gateway.environment,
      orderId,
      paymentSessionId: payment.gatewaySessionId,
      expiresAt: payment.gatewayExpiresAt,
    };
  }

  const phone = gatewayPhone(booking.driver.phone);
  if (!phone) throw phoneRequired();

  const split = await splitFor(booking, payment);

  const name = [booking.driver.firstName, booking.driver.lastName].filter(Boolean).join(" ").trim();
  const email = booking.driver.email;

  const order = await gateway.createOrder({
    orderId,
    amount: payment.amount.toFixed(2),
    currency: "INR",
    customer: {
      // Alphanumeric only, which a UUID is once its hyphens go.
      id: driverId.replace(/-/g, ""),
      phone,
      ...(email.length >= 3 && email.length <= 100 ? { email } : {}),
      ...(name.length >= 3 && name.length <= 100 ? { name } : {}),
    },
    expiresAt: orderExpiry(booking.holdExpiresAt),
    tags: {
      booking_id: booking.id,
      ...(booking.listingId ? { listing_id: booking.listingId } : {}),
    },
    // The row's own id: one per booking, the same on every retry.
    idempotencyKey: payment.id,
    returnUrl: `${env.API_PUBLIC_URL.replace(/\/$/, "")}/payments/return?order_id={order_id}`,
    // Absent without a public address (local development without a tunnel):
    // the pay screen's checks still confirm the booking.
    ...(env.WEBHOOK_PUBLIC_URL ? { notifyUrl: `${env.WEBHOOK_PUBLIC_URL.replace(/\/$/, "")}/webhooks/cashfree` } : {}),
    // Nothing to split out of a zero share (a 100% service fee).
    splits: split.amount.greaterThan(0) ? [{ vendorId: split.vendorId, amount: split.amount.toFixed(2) }] : [],
  });

  // Conditional on the row still waiting, so a webhook that already moved it
  // on is never overwritten by a late answer to this call.
  await prisma.payment.updateMany({
    where: { id: payment.id, status: "CREATED" },
    data: {
      provider: order.provider,
      gatewayOrderId: order.orderId,
      gatewayOrderRef: order.orderRef,
      gatewaySessionId: order.sessionId,
      gatewayExpiresAt: order.expiresAt,
      updatedBy: driverId,
    },
  });

  audit("PAYMENT_ORDER_CREATED", {
    userId: driverId,
    bookingId: booking.id,
    paymentId: payment.id,
    provider: order.provider,
    orderId: order.orderId,
  });

  return {
    provider: order.provider,
    environment: gateway.environment,
    orderId: order.orderId,
    paymentSessionId: order.sessionId,
    expiresAt: order.expiresAt,
  };
}

/**
 * The row for a hold placed while no gateway was configured. Two replays
 * racing here both land on the one row: the loser's insert hits the unique
 * bookingId and reads the winner's.
 */
async function openLateRow(
  booking: Prisma.BookingGetPayload<{ select: typeof orderRow }>,
  driverId: string,
  gateway: PaymentGateway
) {
  const select = orderRow.payment.select;
  try {
    return await prisma.payment.create({
      data: {
        bookingId: booking.id,
        amount: payableTotal(booking),
        status: "CREATED",
        provider: gateway.name,
        gatewayOrderId: gatewayOrderIdFor(booking.id),
        createdBy: driverId,
        updatedBy: driverId,
      },
      select,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id }, select });
    }
    throw error;
  }
}

export type PayMethod = "UPI" | "CARD";

/**
 * What the checkout may offer. Card only in the gateway's sandbox (owner's
 * decision, 2026-09-27): in production a card through Order Pay needs a PCI
 * DSS certificate GatePass doesn't have, so it stays test-only until that is
 * settled. The API version is the one the app's own card call must send.
 */
export function paymentOptions() {
  const gateway = getPaymentGateway();
  if (!gateway) return { enabled: false, environment: null, apiVersion: null, methods: [] as PayMethod[] };

  return {
    enabled: true,
    environment: gateway.environment,
    apiVersion: env.CASHFREE_API_VERSION,
    methods: (gateway.environment === "sandbox" ? ["UPI", "CARD"] : ["UPI"]) as PayMethod[],
  };
}

export type UpiPaymentView =
  | { channel: "INTENT"; apps: Partial<Record<UpiApp, string>>; expiresAt: Date }
  | { channel: "QR"; qrImage: string; expiresAt: Date };

/**
 * Starts a UPI payment for the driver's own unpaid hold: links into a UPI
 * app, or a QR to scan.
 *
 * Goes through openOrder, so the booking is loaded with the driver in the
 * WHERE (someone else's is a 404) and must still be a live, unpaid hold; an
 * order whose first attempt failed is opened here. Each call is a new attempt
 * on the same order -- a driver who backs out of one app can open another.
 */
export async function startUpi(
  bookingId: string,
  driverId: string,
  input: { channel: "INTENT" | "QR"; client: ClientHints }
): Promise<UpiPaymentView> {
  const gateway = getPaymentGateway();
  if (!gateway) throw new AppError("Online payment isn't switched on.", 409, "PAYMENTS_OFF");

  const checkout = await openOrder(bookingId, driverId);
  if (!checkout) {
    throw new AppError("This booking can't be paid for any more. Its hold may have ended.", 409, "NOT_PAYABLE");
  }

  const attempt = await gateway.startUpiPayment({
    sessionId: checkout.paymentSessionId,
    channel: input.channel,
    client: input.client,
  });

  audit("PAYMENT_ATTEMPT_STARTED", {
    userId: driverId,
    bookingId,
    provider: gateway.name,
    orderId: checkout.orderId,
    method: "UPI",
    channel: attempt.channel,
    paymentRef: attempt.paymentRef,
  });

  return attempt.channel === "QR"
    ? { channel: "QR", qrImage: attempt.qrImage, expiresAt: checkout.expiresAt }
    : { channel: "INTENT", apps: attempt.apps, expiresAt: checkout.expiresAt };
}

const ORDER_ID = /^bk_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const PHONE_AGENT = /android|iphone|ipad|ipod/i;

/**
 * Where a driver coming back from a gateway payment page goes: the booking's
 * pay screen, in the app on a phone and on the web app otherwise.
 *
 * Reads nothing and changes nothing -- the booking's state comes from the
 * gateway, never from this redirect. Both targets are fixed; only a booking
 * id that parses as one goes into them, so this can't send anyone elsewhere.
 */
export function returnTarget(orderId: string, userAgent: string | undefined): string {
  const bookingId = ORDER_ID.exec(orderId)?.[1];
  if (!bookingId) throw badRequest("Unknown order");

  const path = `booking/${bookingId.toLowerCase()}/pay`;
  return PHONE_AGENT.test(userAgent ?? "")
    ? `gatepass://${path}`
    : `${env.APP_WEB_URL.replace(/\/$/, "")}/${path}`;
}

/**
 * The driver's own payments. What they paid and where it stands -- no gateway
 * ids or checkout session: those are for the checkout, not a history list.
 */
export async function listForDriver(driverId: string) {
  return prisma.payment.findMany({
    where: { booking: { driverId } },
    select: { id: true, bookingId: true, amount: true, status: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
