import { badRequest, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

export interface CreatePaymentInput {
  bookingId: string;
  razorpayOrderId?: string;
}

/** The driver's own payments. */
export async function listForDriver(driverId: string) {
  return prisma.payment.findMany({
    where: { booking: { driverId } },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Opens a payment against the driver's own booking.
 *
 * Amount comes from the booking and status is fixed at CREATED: a caller who
 * could set either would be able to mark their own booking paid for zero.
 * Moving a payment to CAPTURED is the webhook's job and that is not built --
 * see IMPLEMENTATION.md.
 */
export async function create(input: CreatePaymentInput, driverId: string) {
  const booking = await prisma.booking.findFirst({
    where: { id: input.bookingId, driverId },
    select: { id: true, amount: true, payment: { select: { id: true } } },
  });

  if (!booking) {
    throw notFound("Booking not found");
  }

  if (booking.payment) {
    throw badRequest("This booking already has a payment");
  }

  return prisma.payment.create({
    data: {
      bookingId: booking.id,
      amount: booking.amount,
      razorpayOrderId: input.razorpayOrderId,
      status: "CREATED",
      createdBy: driverId,
      updatedBy: driverId,
    },
  });
}
