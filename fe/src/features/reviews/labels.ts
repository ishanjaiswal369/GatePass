import type { SubRatingKey } from "@/types/api.types";

/**
 * The optional questions under the overall stars, in the order the Rate
 * screen asks them; `label` is how the averages are captioned on a spot.
 */
export const SUB_RATINGS: { key: SubRatingKey; label: string; question: string }[] = [
  { key: "easyToFind", label: "Easy to find", question: "How easy was it to find?" },
  { key: "asDescribed", label: "As described", question: "Was the parking as described?" },
  { key: "access", label: "Access", question: "Was access convenient?" },
];

/** What each overall rating means, said back to the driver as they tap. */
export const STAR_WORDS: Record<number, string> = {
  1: "Terrible",
  2: "Poor",
  3: "Okay",
  4: "Good",
  5: "Excellent",
};

/** "128 reviews", "1 review". */
export function reviewCountLabel(count: number): string {
  return `${count} ${count === 1 ? "review" : "reviews"}`;
}

/**
 * "Today", "2 days ago", "3 weeks ago", "5 months ago": how old a review is,
 * as review lists read. Past a year, the month and year.
 */
export function reviewAge(iso: string, now = Date.now()): string {
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
  }
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months} ${months === 1 ? "month" : "months"} ago`;
  }
  return new Date(iso).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}
