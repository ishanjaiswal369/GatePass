import type { ChipTone } from "@/components/ui";
import type { BookingListing, BookingPhase, BookingRow, VehicleType } from "@/types/api.types";

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
    // A paid extension moves when the driver has to leave.
    const to = new Date(row.effectiveEndsAt ?? row.endsAt);
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

/**
 * How much longer an unpaid hold lasts, in whole minutes.
 *
 * Null when the booking is not holding anything: an event booking, which has
 * no hold, or a spot booking past PENDING, whose `holdExpiresAt` is still set
 * but no longer decides anything. 0 means the hold has lapsed and the next
 * driver to ask for those hours will sweep it.
 */
export function holdMinutesLeft(row: BookingRow): number | null {
  if (row.status !== "PENDING" || !row.holdExpiresAt) return null;

  const left = Date.parse(row.holdExpiresAt) - Date.now();
  return Number.isNaN(left) ? null : Math.max(0, Math.ceil(left / 60_000));
}

/**
 * The phase in words, with the tone it is shown in. One table so the list,
 * the detail and the parked screen never describe the same state two ways.
 */
const PHASES: Record<BookingPhase, { label: string; tone: ChipTone }> = {
  PENDING: { label: "Awaiting payment", tone: "warning" },
  EXPIRED: { label: "Hold expired", tone: "neutral" },
  UPCOMING: { label: "Confirmed", tone: "success" },
  ACTIVE: { label: "Parked now", tone: "ink" },
  COMPLETED: { label: "Completed", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export function phaseChip(row: Pick<BookingRow, "phase">): { label: string; tone: ChipTone } {
  return PHASES[row.phase];
}

/** "2h 41m", "45m", "1d 3h" -- time left until an instant. */
export function timeLeft(untilIso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((Date.parse(untilIso) - now) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(mins).padStart(2, "0")}m`;
  return `${mins}m`;
}

/** How far through a stay we are, 0..1, for a progress bar. */
export function stayProgress(row: BookingRow, now = Date.now()): number {
  if (!row.startsAt) return 0;
  const start = Date.parse(row.startsAt);
  const end = Date.parse(row.effectiveEndsAt ?? row.endsAt ?? row.startsAt);
  if (end <= start) return 1;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * A Google Maps directions link to the space. Coordinates when the spot has
 * them, because an Indian street address often geocodes to the wrong lane;
 * the address otherwise.
 */
export function directionsUrl(listing: BookingListing | null): string | null {
  if (!listing) return null;

  const destination =
    listing.latitude && listing.longitude
      ? `${listing.latitude},${listing.longitude}`
      : [listing.addressLine, listing.city].filter(Boolean).join(", ") || listing.venueName;

  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

/** Extra time chosen on this stay that is still waiting to be paid for. */
export function unpaidExtension(row: BookingRow, now = Date.now()) {
  return (
    row.extensions.find(
      (e) => e.status === "PENDING" && e.holdExpiresAt !== null && Date.parse(e.holdExpiresAt) > now
    ) ?? null
  );
}

/**
 * The reference a driver reads out to support: "GP-" and the first six
 * characters of the booking id. Derived, not stored, so it can never drift
 * from the id -- support finds the booking by prefix.
 */
export function bookingRef(id: string): string {
  return `GP-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}
