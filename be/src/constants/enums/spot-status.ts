/**
 * A host spot's own moderation state, separate from Listing.status (which is
 * publish lifecycle: DRAFT/PUBLISHED/ONGOING/COMPLETED/CANCELLED) and from
 * HostProfile.verificationStatus (which is the host's own KYC as a payee, one
 * row per host). A host can list several spots; each one is reviewed on its
 * own.
 */
export const SPOT_STATUSES = ["PENDING", "IN_REVIEW", "ACTIVE", "DECLINED"] as const;

export type SpotStatus = (typeof SPOT_STATUSES)[number];

/**
 * Spot review is self-serve for now, same as HostProfile's own
 * verificationStatus: a new spot is bookable immediately rather than stuck at
 * PENDING with no reviewer to move it forward. This column exists so turning
 * review on later is a data change, not a schema change -- see the same note
 * on VERIFICATION_STATUSES.
 */
export const DEFAULT_SPOT_STATUS: SpotStatus = "ACTIVE";
