/**
 * Response shapes returned by the API. One place, so a backend change is a
 * single edit here and the compiler points at every screen that must follow.
 */

import type { Role } from "@/constants/enums";

export interface AuthUser {
  id: string;
  email: string;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  role: Role;
}

export interface VerifyCodeResult {
  token: string;
  user: AuthUser;
  profileComplete: boolean;
}

export interface MeResult extends AuthUser {
  profileComplete: boolean;
}

export interface SessionRow {
  id: string;
  deviceId: string;
  deviceType: string;
  deviceName: string | null;
  lastActiveAt: string;
  createdAt: string;
  current: boolean;
}

export interface HealthResult {
  status: string;
  timestamp: string;
  integrations: { email: string };
}
