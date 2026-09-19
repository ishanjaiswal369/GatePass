/**
 * Response shapes returned by the API. One place, so a backend change is a
 * single edit here and the compiler points at every screen that must follow.
 */

import type {
  BookingStatus,
  ListingStatus,
  ListingType,
  Role,
  VehicleType,
  VerificationStatus,
} from "@/constants/enums";

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
  /** Whether a HostProfile row exists, so the Host tab knows where it leads. */
  hasHostProfile: boolean;
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

/** Cursor-paginated list. `nextCursor` is opaque -- pass it back unchanged. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface EventFeedItem {
  id: string;
  name: string;
  venueName: string;
  eventDate: string;
  latitude: number | null;
  longitude: number | null;
  minPrice: number;
  spotsLeft: number;
  vehicleTypes: VehicleType[];
  /** Null unless the request carried a position. */
  distanceKm: number | null;
}

export interface EventCapacity {
  id: string;
  vehicleType: VehicleType;
  gate: string | null;
  price: string;
  spotsLeft: number;
}

export interface EventDetail {
  id: string;
  name: string;
  venueName: string;
  eventDate: string | null;
  latitude: string | null;
  longitude: string | null;
  listingType: ListingType;
  status: ListingStatus;
  organizer: { name: string } | null;
  capacities: EventCapacity[];
}

export interface BookingRow {
  id: string;
  quantity: number;
  amount: string;
  status: BookingStatus;
  vehicleNumber: string;
  createdAt: string;
  parkingCapacity: {
    id: string;
    vehicleType: VehicleType;
    gate: string | null;
    price: string;
    listing: {
      id: string;
      name: string;
      venueName: string;
      eventDate: string | null;
      listingType: ListingType;
      status: ListingStatus;
    };
  };
}

export interface GatePassResult {
  booking: {
    id: string;
    gate: string | null;
    vehicleType: VehicleType;
    eventName: string;
    venueName: string;
    eventDate: string | null;
  };
  /** Short-lived; re-fetch once `expiresInSeconds` has run down. */
  pass: { token: string; expiresAt: string; expiresInSeconds: number };
}

export interface NearbySpot {
  id: string;
  name: string;
  venueName: string;
  city: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  pricePerHour: number;
  availableUntilMinute: number;
}

export interface HostProfile {
  id: string;
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
  latitude: string;
  longitude: string;
  verificationStatus: VerificationStatus;
  createdAt: string;
}

export interface HostAvailabilityRow {
  id: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  pricePerHour: string;
  isActive: boolean;
}

export interface GeocodeResult {
  providerPlaceId?: string;
  description: string;
  latitude: number;
  longitude: number;
}
