import type { SubRatingKey } from "@/types/api.types";

/** The optional questions under the overall stars, in the order they're asked. */
export const SUB_RATINGS: { key: SubRatingKey; label: string; question: string }[] = [
  { key: "easyToFind", label: "Easy to find", question: "Was it easy to find?" },
  { key: "asDescribed", label: "As described", question: "Was the space as described?" },
  { key: "access", label: "Access", question: "How was getting in and out?" },
];

/** What each overall rating means, said back to the driver as they tap. */
export const STAR_WORDS: Record<number, string> = {
  1: "Poor",
  2: "Not great",
  3: "Okay",
  4: "Good",
  5: "Excellent",
};

/** "12 reviews", "1 review". */
export function reviewCountLabel(count: number): string {
  return `${count} ${count === 1 ? "review" : "reviews"}`;
}

/** "September 2026": when a review was left, to the month, as review lists read. */
export function reviewMonth(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}
