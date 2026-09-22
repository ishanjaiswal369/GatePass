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

/**
 * A host, with no address of their own: each spot carries the address that
 * describes it, and a host with two driveways has two.
 */
export interface HostProfile {
  id: string;
  verificationStatus: VerificationStatus;
  payoutKycStatus: PayoutKycStatus;
  createdAt: string;
}

export interface AvailabilityWindow {
  id: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  isActive: boolean;
}

/**
 * A window as `/host/availability` returns it -- across every spot a host
 * has, so `listingId` is what tells one spot's windows apart from another's.
 * A single spot's own read (SpotListing.availability) already knows which
 * spot it belongs to and does not carry the field.
 */
export interface HostAvailabilityRow extends AvailabilityWindow {
  listingId: string;
}

/**
 * A postal address split into the fields the listing stores.
 *
 * Every part is optional: the provider fills in what it knows about the point,
 * and a pin on a service lane may have no street to name. A part that came
 * back empty leaves the matching field alone rather than clearing it.
 */
export interface AddressParts {
  addressLine?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

export interface GeocodeResult {
  providerPlaceId?: string;
  description: string;
  latitude: number;
  longitude: number;
  /** Present on lookups that answer with components; absent on suggestions. */
  address?: AddressParts;
}

/**
 * One type-ahead suggestion. Coordinates are optional: autocomplete APIs
 * generally answer with an id and a label and bill for the coordinates as a
 * separate lookup, so a suggestion without them needs placeDetails before it
 * can become a pin.
 */
/** What the map image shows. Satellite here means hybrid: imagery plus the
 * road labels, so a host can still tell which road their gate faces. */
export type MapType = "roadmap" | "satellite" | "hybrid";

export interface PlaceSuggestion {
  providerPlaceId?: string;
  description: string;
  latitude?: number;
  longitude?: number;
  /** Only when the suggestion is really a search result -- see GeocodeResult. */
  address?: AddressParts;
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

/**
 * A host spot as a driver sees it before booking.
 *
 * No `accessInstructions`: those are the gate code and the guard's name, and
 * they arrive with a paid booking, never with a search result.
 */
export interface PublicSpot {
  id: string;
  name: string;
  venueName: string;
  spaceType: SpaceType | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  latitude: string | null;
  longitude: string | null;
  photos: SpotPhoto[];
  pricing: SpotPricingRow[];
  availability: AvailabilityWindow[];
}

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
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
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
  availability: AvailabilityWindow[];
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

/**
 * The host's own read of their payout details. The account number comes back
 * as its last four digits only -- enough to recognise what was submitted,
 * which is all this screen is for.
 */
export interface PayoutAccount {
  payoutAccountId: string | null;
  payoutKycStatus: PayoutKycStatus;
  panNumber: string | null;
  accountHolderName: string | null;
  accountNumberLast4: string | null;
  ifsc: string | null;
  submittedAt: string | null;
  /**
   * Whether the host still has to enter their details. Not derivable from
   * the status: an account submitted before the details were stored reads as
   * UNDER_REVIEW with nothing behind it, and only the API knows that.
   */
  needsDetails: boolean;
}
