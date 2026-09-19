import type { DeviceType } from "../constants/enums/index.js";
import { conflict, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { consumeCode, requestCode } from "./auth.service.js";

/** Booking states that still involve money or a car turning up. */
const OPEN_BOOKING_STATUSES = ["PENDING", "CONFIRMED"];
/** Settlement states where a payout to the host is not finished. */
const UNSETTLED_STATUSES = ["PENDING", "PROCESSING", "DISPUTED"];

/**
 * Reasons this account cannot be deleted right now, in the words the app
 * shows. Empty means it can go.
 *
 * Deletion is soft, so nothing here protects the database -- the rows all
 * stay. These protect people: a driver who is expected at a gate, drivers
 * booked into this host's spot, a payout still owed, an organizer that would
 * be left with nobody to run it.
 */
export async function deletionBlockers(userId: string): Promise<string[]> {
  const blockers: string[] = [];

  const [openBookings, host, memberships] = await Promise.all([
    prisma.booking.count({
      where: { driverId: userId, status: { in: OPEN_BOOKING_STATUSES } },
    }),
    prisma.hostProfile.findUnique({
      where: { userId },
      select: { id: true },
    }),
    prisma.organizerMember.count({ where: { userId } }),
  ]);

  if (openBookings > 0) {
    blockers.push(
      `You have ${openBookings} upcoming booking${openBookings === 1 ? "" : "s"}. Cancel ${openBookings === 1 ? "it" : "them"} or wait until ${openBookings === 1 ? "it's" : "they're"} over.`
    );
  }

  if (host) {
    const [hostBookings, unsettled] = await Promise.all([
      prisma.booking.count({
        where: {
          status: { in: OPEN_BOOKING_STATUSES },
          parkingCapacity: { listing: { hostProfileId: host.id } },
        },
      }),
      prisma.settlement.count({
        where: { hostProfileId: host.id, status: { in: UNSETTLED_STATUSES } },
      }),
    ]);

    if (hostBookings > 0) {
      blockers.push(
        `Drivers have ${hostBookings} upcoming booking${hostBookings === 1 ? "" : "s"} at your spot.`
      );
    }

    if (unsettled > 0) {
      blockers.push(
        `${unsettled} payout${unsettled === 1 ? " to you is" : "s to you are"} still being processed.`
      );
    }
  }

  if (memberships > 0) {
    blockers.push(
      "You manage an organizer account. Hand it over or close it first."
    );
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
        where: { hostProfileId: host.id },
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
