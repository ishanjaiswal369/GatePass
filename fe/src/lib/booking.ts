import type { BookingListing, BookingRow, VehicleType } from "@/types/api.types";

/**
 * Reading a booking without caring which shape it is.
 *
 * A booking is either slots at a dated event (through `parkingCapacity`) or
 * hours at a host's spot (through `listing` plus a time range). Every screen
 * shows the same four things about both -- where, what vehicle, when, how
 * much -- so the branching happens here once instead of at each of them.
 */

export function bookingListing(row: BookingRow): BookingListing | null {
  return row.listing ?? row.parkingCapacity?.listing ?? null;
}

export function bookingVehicleType(row: BookingRow): VehicleType | null {
  return row.parkingCapacity?.vehicleType ?? row.vehicleType ?? null;
}

/** A host spot has no gate: getting in is the access instructions' job. */
export function bookingGate(row: BookingRow): string | null {
  return row.parkingCapacity?.gate ?? null;
}

export function isSpotBooking(row: BookingRow): boolean {
  return row.startsAt !== null;
}

function timeOf(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function dayOf(date: Date): string {
  const days = Math.round(
    (new Date(date).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) /
      86_400_000
  );

  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";

  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * When the booking is for, in one line.
 *
 * A spot booking is a range and says so; an event booking is a start time. An
 * undated event ("Any time") is a real state -- a listing can be published
 * without a date -- rather than missing data.
 */
export function bookingWhen(row: BookingRow): string {
  if (row.startsAt && row.endsAt) {
    const from = new Date(row.startsAt);
    const to = new Date(row.endsAt);
    const sameDay = from.toDateString() === to.toDateString();

    return sameDay
      ? `${dayOf(from)} · ${timeOf(from)} – ${timeOf(to)}`
      : `${dayOf(from)} ${timeOf(from)} – ${dayOf(to)} ${timeOf(to)}`;
  }

  const eventDate = bookingListing(row)?.eventDate;
  if (!eventDate) return "Any time";

  const date = new Date(eventDate);
  return `${dayOf(date)} · ${timeOf(date)}`;
}
