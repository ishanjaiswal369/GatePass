export const LISTING_STATUSES = [
  "DRAFT",
  // Host spots only: submitted by the host, waiting on an admin to check the
  // ownership document. Event listings go straight from DRAFT to PUBLISHED --
  // an organizer is onboarded by a human before they ever reach the API.
  "PENDING_REVIEW",
  "REJECTED",
  "PUBLISHED",
  "ONGOING",
  "COMPLETED",
  "CANCELLED",
  // Taken down after going live: a complaint, an expired document, a host who
  // stopped answering. Distinct from REJECTED, which never went live at all.
  "SUSPENDED",
] as const;

export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const DEFAULT_LISTING_STATUS: ListingStatus = "DRAFT";

/** Statuses a host spot can be booked in. */
export const BOOKABLE_LISTING_STATUSES: readonly ListingStatus[] = [
  "PUBLISHED",
  "ONGOING",
];
