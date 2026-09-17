export const ROLES = ["DRIVER", "ORGANIZER", "ADMIN"] as const;

export type Role = (typeof ROLES)[number];

export const DEFAULT_ROLE: Role = "DRIVER";
