/** What a driver can say is wrong, in the order the Report screen lists them. */
export const PROBLEM_CATEGORIES = [
  "CANT_FIND",
  "OCCUPIED",
  "GATE_LOCKED",
  "NOT_AS_LISTED",
  "HOST_UNRESPONSIVE",
  "OTHER",
] as const;

export type ProblemCategory = (typeof PROBLEM_CATEGORIES)[number];

export const PROBLEM_STATUSES = ["OPEN", "RESOLVED"] as const;

export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];
