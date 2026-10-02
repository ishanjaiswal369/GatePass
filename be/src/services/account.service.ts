import type { DeviceType } from "../constants/enums/index.js";
import { conflict, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { consumeCode, requestCode } from "./auth.service.js";

/** Booking states that still involve money or a car turning up. */
const OPEN_BOOKING_STATUSES = ["PENDING", "CONFIRMED"];

/**
 * Reasons this account cannot be deleted right now, in the words the app
 * shows. Empty means it can go.
 *
 * Deletion is soft, so nothing here protects the database -- the rows all
 * stay. These protect people: a driver who is expected at a gate, and drivers
 * booked into this host's spot. (A host's money is paid out by the gateway
 * from each order -- Easy Split -- so no payout of ours can be left owing.)
 */
export async function deletionBlockers(userId: string): Promise<string[]> {
  const blockers: string[] = [];

  const [openBookings, host] = await Promise.all([
    prisma.booking.count({
      where: { driverId: userId, status: { in: OPEN_BOOKING_STATUSES } },
    }),
    prisma.hostProfile.findUnique({
      where: { userId },
      select: { id: true },
    }),
  ]);

  if (openBookings > 0) {
    blockers.push(
      `You have ${openBookings} upcoming booking${openBookings === 1 ? "" : "s"}. Cancel ${openBookings === 1 ? "it" : "them"} or wait until ${openBookings === 1 ? "it's" : "they're"} over.`
    );
  }

  if (host) {
    // Open bookings on any of this host's spots.
    const hostBookings = await prisma.booking.count({
      where: {
        status: { in: OPEN_BOOKING_STATUSES },
        listing: { hostProfileId: host.id },
      },
    });

    if (hostBookings > 0) {
      blockers.push(
        `Drivers have ${hostBookings} upcoming booking${hostBookings === 1 ? "" : "s"} at your spot.`
      );
    }
  }


  return blockers;
}

async function activeUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, deletedAt: true },
  });

  if (!user || user.deletedAt) {
    throw notFound("User not found");
  }

  return user;
}

async function assertDeletable(userId: string): Promise<void> {
  const blockers = await deletionBlockers(userId);
  if (blockers.length > 0) {
    throw conflict(blockers[0]!);
  }
}

/**
 * Mails a confirmation code to the account's own address. The address comes
 * from the session, never the request, so the code can only reach the owner.
 * Blockers are checked first, so nobody is sent a code for a deletion that
 * will be refused anyway.
 */
export async function requestDeletionCode(
  userId: string,
  device: { deviceId: string; deviceType: DeviceType }
) {
  const user = await activeUser(userId);
  await assertDeletable(userId);

  return requestCode({
    email: user.email,
    ...device,
    purpose: "ACCOUNT_DELETE",
  });
}

/**
 * Soft-deletes the account once the emailed code checks out.
 *
 * Nothing is removed and nothing is scrubbed: the user row, profile, vehicles,
 * address, bookings and payments all stay exactly as they were, with
 * `deletedAt` stamped on the user. What changes is what the account can do:
 *
 * - every session is revoked, so all devices are signed out now;
 * - every sign-in path refuses it (see assertNotDeleted in auth.service);
 * - a host's spot is taken out of search -- listings cancelled, availability
 *   switched off -- so drivers cannot book with someone who has left.
 *
 * Because the data is intact, restoring an account later is a matter of
 * clearing `deletedAt` (a host would then re-enable their availability).
 */
export async function deleteAccount(userId: string, code: string) {
  const user = await activeUser(userId);

  await consumeCode({ email: user.email, purpose: "ACCOUNT_DELETE", code });

  // Again, after the code: a booking may have been made while the email was
  // on its way.
  await assertDeletable(userId);

  await prisma.$transaction(async (tx) => {
    const host = await tx.hostProfile.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (host) {
      await tx.listing.updateMany({
        where: { hostProfileId: host.id },
        data: { status: "CANCELLED", updatedBy: userId },
      });
      await tx.hostAvailability.updateMany({
        where: { listing: { hostProfileId: host.id } },
        data: { isActive: false },
      });
    }

    await tx.userSession.deleteMany({ where: { userId } });

    await tx.user.update({
      where: { id: userId },
      data: { deletedAt: new Date() },
    });
  });
}
