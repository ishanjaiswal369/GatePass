import type { ProblemCategory } from "@/constants/enums";

/** The Report screen's options, in the prototype's words. */
export const PROBLEM_LABELS: Record<ProblemCategory, string> = {
  CANT_FIND: "I can't find the parking",
  OCCUPIED: "Parking is occupied",
  GATE_LOCKED: "Gate is locked",
  NOT_AS_LISTED: "Parking doesn't match the listing",
  HOST_UNRESPONSIVE: "Host isn't responding",
  OTHER: "Other",
};

/** Short form for a status line: "You reported: gate is locked". */
export function problemShort(category: ProblemCategory): string {
  const label = PROBLEM_LABELS[category];
  return label.charAt(0).toLowerCase() + label.slice(1);
}
