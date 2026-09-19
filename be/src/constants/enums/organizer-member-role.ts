export const ORGANIZER_MEMBER_ROLES = ["OWNER", "MANAGER", "STAFF"] as const;

export type OrganizerMemberRole = (typeof ORGANIZER_MEMBER_ROLES)[number];

export const DEFAULT_ORGANIZER_MEMBER_ROLE: OrganizerMemberRole = "OWNER";
