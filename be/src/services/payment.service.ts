import { Prisma } from "@prisma/client";
import { getPaymentGateway, type PaymentGateway } from "../integrations/payment/index.js";
import { AppError, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/security-log.js";

/**
 * Money in: the Payment row a booking is paid through, and the gateway order
 * behind it.
 *
 * Nothing here takes an amount, an order id or a status from the caller. The
 * amount is the booking's own (parking + platform fee + GST, fixed when it was
 * made), the order id is derived from the booking, and the status only ever
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
 * Refuses up front when a gateway is on and the driver has no mobile number.
 *
 * Called before a booking is placed, so a driver who can't pay yet never
 * holds hours they can't pay for. With no gateway configured there is
 * nothing to check.
 */
export async function assertCanPay(driverId: string): Promise<void> {
  if (!getPaymentGateway()) return;

  const driver = await prisma.user.findUnique({ where: { id: driverId }, select: { phone: true } });
  if (!gatewayPhone(driver?.phone ?? null)) throw phoneRequired();
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
  payment: {
    select: {
      id: true,
      status: true,
      amount: true,
      gatewayOrderId: true,
      gatewaySessionId: true,
      gatewayExpiresAt: true,
    },
  },
} satisfies Prisma.BookingSelect;

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
    expiresAt: booking.holdExpiresAt,
    tags: {
      booking_id: booking.id,
      ...(booking.listingId ? { listing_id: booking.listingId } : {}),
    },
    // The row's own id: one per booking, the same on every retry.
    idempotencyKey: payment.id,
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

/**
 * The driver's own payments. What they paid and where it stands -- no gateway
 * ids or checkout session: those are for the checkout, not a history list.
 */
export async function listForDriver(driverId: string) {
  return prisma.payment.findMany({
    where: { booking: { driverId } },
    select: { id: true, bookingId: true, amount: true, status: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: "desc" },
  });
}
