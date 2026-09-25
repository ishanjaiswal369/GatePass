import type { SpotListing, SpotListingStatus } from "@/types/api.types";
import type { ChipTone } from "@/components/ui";

/**
 * The listing wizard's rules, mirrored from the API for inline messages.
 * The API is what decides (be/src/lib/listing-name.ts, the request schemas);
 * these only let a screen say what's wrong before the host presses Continue.
 */

export const NAME_EXAMPLE = "Covered parking near Kothrud Depot";

const SUPERLATIVES = /\b(best|cheapest|lowest|top|number\s*one|no\.?\s*1|guaranteed|guarantee)\b|#\s*1\b|100\s*%/i;

/** Why a listing name reads as an advert, or null. Same rule as the API. */
export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length > 0 && trimmed.length < 5) return `Say what and where the space is, e.g. “${NAME_EXAMPLE}”.`;
  if (/[!?]{2,}/.test(trimmed)) return "Leave out repeated ! or ?.";
  if (SUPERLATIVES.test(trimmed)) return "Leave out claims like “best” or “cheapest” — say what and where the space is.";
  const letters = trimmed.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 6 && letters === letters.toUpperCase()) return "Don't write the name in capitals.";
  return null;
}

/** "2 hours", "90 minutes", "1 day" -- as the API words its rules. */
export function durationText(minutes: number): string {
  if (minutes % 1440 === 0) return minutes === 1440 ? "1 day" : `${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? "1 hour" : `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

/** Feet (what hosts here measure in) to the centimetres the API stores. */
export const feetToCm = (feet: number) => Math.round(feet * 30.48);

/** Centimetres back to feet for an input, one decimal at most: 213 → "7". */
export function cmToFeetText(cm: number | null): string {
  if (!cm) return "";
  const feet = Math.round((cm / 30.48) * 10) / 10;
  return String(feet);
}

/**
 * Where a listing stands, in the host's words. The database keeps its own
 * statuses; "Approved" is a pending listing whose document has been accepted
 * and which goes live when the payout account is active.
 */
export function listingStatus(spot: Pick<SpotListing, "status" | "docApprovedAt" | "bookingsPausedAt">): {
  label: string;
  tone: ChipTone;
} {
  const table: Partial<Record<SpotListingStatus, { label: string; tone: ChipTone }>> = {
    DRAFT: { label: "Draft", tone: "neutral" },
    PENDING_REVIEW: spot.docApprovedAt ? { label: "Approved", tone: "success" } : { label: "Under review", tone: "warning" },
    REJECTED: { label: "Needs changes", tone: "danger" },
    PUBLISHED: spot.bookingsPausedAt ? { label: "Paused", tone: "warning" } : { label: "Live", tone: "success" },
    ONGOING: { label: "Live", tone: "success" },
    SUSPENDED: { label: "Suspended", tone: "danger" },
    CANCELLED: { label: "Removed", tone: "neutral" },
  };
  return table[spot.status] ?? { label: spot.status, tone: "neutral" };
}

/** The vehicle types a listing takes: its own list, or (older listings) the types it prices. */
export function vehicleTypesOf(spot: Pick<SpotListing, "vehicleTypes" | "pricing">): ("CAR" | "BIKE")[] {
  const types = spot.vehicleTypes.length ? spot.vehicleTypes : spot.pricing.map((row) => row.vehicleType);
  return types.filter((t): t is "CAR" | "BIKE" => t === "CAR" || t === "BIKE");
}
