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
  /** Whether a password is set. The hash itself never leaves the server. */
  hasPassword: boolean;
  /**
   * Whether a HostProfile exists. Sent with every sign-in and /auth/me, so the
   * Host tab picks onboarding or the dashboard without a request of its own.
   */
  hasHostProfile: boolean;
}

export interface VerifyCodeResult {
  token: string;
  user: AuthUser;
  profileComplete: boolean;
}

export interface ChangePasswordResult {
  user: AuthUser;
  /** Other devices signed out by the change; the caller's own is kept. */
  signedOutSessions: number;
}

/**
 * GET/PATCH /auth/me. Vehicles and address are eager-loaded in the same
 * response, so the profile hub is one request rather than three.
 */
export interface MeResult extends AuthUser {
  profileComplete: boolean;
  vehicles: Vehicle[];
  address: UserAddress | null;
}

export interface DeletionStatus {
  /** Why the account cannot be deleted right now. Empty means it can. */
  blockers: string[];
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
  isActive: boolean;
}

export interface GeocodeResult {
  providerPlaceId?: string;
  description: string;
  latitude: number;
  longitude: number;
}

/**
 * One type-ahead suggestion. Coordinates are optional: autocomplete APIs
 * generally answer with an id and a label and bill for the coordinates as a
 * separate lookup, so a suggestion without them needs placeDetails before it
 * can become a pin.
 */
export interface PlaceSuggestion {
  providerPlaceId?: string;
  description: string;
  latitude?: number;
  longitude?: number;
}

export interface Vehicle {
  id: string;
  vehicleNumber: string;
  vehicleType: VehicleType;
  isDefault: boolean;
  createdAt: string;
}

export interface UserAddress {
  id: string;
  /** Always "India" for now; the API does not accept it from the client. */
  country: string;
  state: string;
  city: string;
  addressLine: string;
}

export type { VehicleType } from "@/constants/enums";

/** Where a host's spot listing stands. */
export type SpotListingStatus =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "REJECTED"
  | "PUBLISHED"
  | "ONGOING"
  | "COMPLETED"
  | "CANCELLED"
  | "SUSPENDED";

export type SpaceType = "DRIVEWAY" | "GARAGE" | "CAR_PARK";

/** Mirrors the gateway. Only ACTIVATED can receive money. */
export type PayoutKycStatus =
  | "NOT_STARTED"
  | "PENDING"
  | "UNDER_REVIEW"
  | "ACTIVATED"
  | "REJECTED";

export interface SpotPhoto {
  id: string;
  url: string;
  position: number;
}

export interface SpotPricingRow {
  id: string;
  vehicleType: VehicleType;
  pricePerHour: string;
}

export interface SpotListing {
  id: string;
  name: string;
  venueName: string;
  spaceType: SpaceType | null;
  status: SpotListingStatus;
  latitude: string | null;
  longitude: string | null;
  googlePlaceId: string | null;
  accessInstructions: string | null;
  ownershipDocUrl: string | null;
  warrantyAcceptedAt: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  photos: SpotPhoto[];
  pricing: SpotPricingRow[];
  /** Only present on the single-spot read, not in the list. */
  availability?: HostAvailabilityRow[];
}

/** What the review step needs: whether Submit will be accepted, and why not. */
export interface SpotReadiness {
  ready: boolean;
  missing: string[];
}

export interface PresignedUpload {
  uploadUrl: string;
  fileUrl: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
}

export interface PayoutAccount {
  payoutAccountId: string | null;
  payoutKycStatus: PayoutKycStatus;
}
