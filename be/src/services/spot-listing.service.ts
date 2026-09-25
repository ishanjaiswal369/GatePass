import { Prisma } from "@prisma/client";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/security-log.js";
import { windowsCover } from "../lib/venue-time.js";
import { getLocalStorage, getStorageProvider } from "../integrations/storage/index.js";
import { env } from "../config/env.js";
import * as hostService from "./host.service.js";

/**
 * The host's side of a spot listing: everything between "I have a driveway"
 * and "an admin can review this".
 *
 * A spot is built up across several requests rather than one big POST, because
 * the wizard is long and a host who drops out at the photos step should not
 * lose the four steps before it. Every step writes to the same DRAFT row.
 */

/** Statuses whose content the host is still allowed to change. */
const EDITABLE_STATUSES = ["DRAFT", "REJECTED"];
/**
 * Also changeable once a spot is live: how it's run, not what it is. Prices,
 * hours, access, amenities, limits and photos are the host's to adjust any
 * day (the dashboard's Edit prices / Access instructions). The name and type,
 * the address and the ownership document are what review checked, so they
 * stay locked once live.
 */
const OPERABLE_STATUSES = [...EDITABLE_STATUSES, "PUBLISHED", "ONGOING", "SUSPENDED"];

/** Photos a host may attach to one spot, and the fewest a listing goes to review (or stays live) with. */
const MAX_PHOTOS = 8;
const MIN_PHOTOS = 2;

const IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** Ownership proof is usually a scan or a PDF bill. */
const DOCUMENT_CONTENT_TYPES = [...IMAGE_CONTENT_TYPES, "application/pdf"];

export interface CreateSpotInput {
  name: string;
  spaceType: string;
  venueName: string;
  /** Public; empty clears it. */
  description?: string | null;
}

export interface SaveAddressInput {
  /** Older clients send one line; newer ones the parts, and the line is composed. */
  addressLine?: string;
  societyName?: string | null;
  building?: string | null;
  street?: string | null;
  area?: string;
  city: string;
  state: string;
  pincode: string;
  latitude: number;
  longitude: number;
  googlePlaceId?: string;
  /** True once the host placed the pin on the map; false when it moved since. */
  pinConfirmed?: boolean;
}

export interface SaveDetailsInput {
  covered: boolean;
  amenities: string[];
  amenityNote: string | null;
  vehicleTypes: string[];
  maxVehicleSize: string | null;
  maxVehicleHeightCm: number | null;
  bayWidthCm: number | null;
  bayLengthCm: number | null;
  notes: string | null;
}

export interface BookingRulesInput {
  minStayMinutes: number | null;
  maxStayMinutes: number | null;
  advanceDays: number | null;
}

export interface PermissionInput {
  ownershipDocType: string;
  permissionBasis: string;
  inSociety: boolean;
  societyPermission?: boolean;
}

export interface AvailabilityWindowInput {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

export interface PricingRowInput {
  vehicleType: string;
  /** Absent when the host doesn't rent by the hour. At least one of the two is set. */
  pricePerHour?: number;
  /** Absent when the host doesn't rent by the day. */
  pricePerDay?: number;
}

export interface PresignInput {
  contentType: string;
  contentLength: number;
}

/** What the wizard reads back to rehydrate itself. */
const spotView = {
  id: true,
  name: true,
  venueName: true,
  spaceType: true,
  description: true,
  status: true,
  addressLine: true,
  societyName: true,
  building: true,
  street: true,
  area: true,
  pinConfirmedAt: true,
  city: true,
  state: true,
  pincode: true,
  latitude: true,
  longitude: true,
  googlePlaceId: true,
  accessInstructions: true,
  entryPoint: true,
  entryMethod: true,
  bayNumber: true,
  parkingMarker: true,
  amenities: true,
  amenityNote: true,
  vehicleTypes: true,
  maxVehicleHeightCm: true,
  maxVehicleSize: true,
  bayWidthCm: true,
  bayLengthCm: true,
  minStayMinutes: true,
  maxStayMinutes: true,
  advanceDays: true,
  rules: true,
  bookingsPausedAt: true,
  ownershipDocUrl: true,
  ownershipDocType: true,
  permissionBasis: true,
  inSociety: true,
  societyPermissionAt: true,
  warrantyAcceptedAt: true,
  submittedAt: true,
  docApprovedAt: true,
  reviewedAt: true,
  rejectionReason: true,
  rejectionSection: true,
  createdAt: true,
  photos: {
    select: { id: true, url: true, position: true },
    orderBy: { position: "asc" },
  },
  pricing: {
    select: { id: true, vehicleType: true, pricePerHour: true, pricePerDay: true },
  },
  // Included in the list read as well as the single one, so the dashboard can
  // show each spot's hours without a second round trip for every card.
  availability: {
    select: {
      id: true,
      dayOfWeek: true,
      startMinute: true,
      endMinute: true,
      isActive: true,
    },
    orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
  },
} satisfies Prisma.ListingSelect;

/**
 * Loads the host's own spot, or refuses.
 *
 * hostProfileId sits in the WHERE clause rather than being compared after the
 * read, for the same reason bookings do it: "not yours" and "does not exist"
 * have to be the same answer, or listing ids become an enumeration oracle.
 */
async function ownedSpot(listingId: string, hostProfileId: string) {
  const spot = await prisma.listing.findFirst({
    where: { id: listingId, hostProfileId, listingType: "INDEPENDENT_SPOT" },
    select: { id: true, status: true },
  });

  if (!spot) {
    throw notFound("Spot not found");
  }

  return spot;
}

/**
 * As above, and also refuses once the spot has left the host's hands.
 *
 * Without this an approved listing could have its address swapped after a
 * human checked the ownership document against the old one -- the review
 * would still read as passed, for a place nobody verified.
 */
async function editableSpot(listingId: string, hostProfileId: string) {
  const spot = await ownedSpot(listingId, hostProfileId);

  if (!EDITABLE_STATUSES.includes(spot.status)) {
    throw conflict(
      spot.status === "PENDING_REVIEW"
        ? "This spot is under review and cannot be edited"
        : "This spot is live; contact support to change it"
    );
  }

  return spot;
}

/** The host's own spot, in any state where its day-to-day terms may change. */
async function operableSpot(listingId: string, hostProfileId: string) {
  const spot = await ownedSpot(listingId, hostProfileId);
  if (!OPERABLE_STATUSES.includes(spot.status)) {
    throw conflict("This spot is under review and cannot be edited");
  }
  return spot;
}

export async function listForHost(hostProfileId: string) {
  return prisma.listing.findMany({
    where: { hostProfileId, listingType: "INDEPENDENT_SPOT" },
    select: spotView,
    orderBy: { createdAt: "desc" },
  });
}

export async function getForHost(listingId: string, hostProfileId: string) {
  const spot = await prisma.listing.findFirst({
    where: { id: listingId, hostProfileId, listingType: "INDEPENDENT_SPOT" },
    select: spotView,
  });

  if (!spot) {
    throw notFound("Spot not found");
  }

  return spot;
}

/**
 * Opens a spot, named. This is the wizard's first step for every spot, a
 * host's first and their fifth alike.
 *
 * It used to open a blank row called "New spot" and ask for the name on the
 * next screen. Anyone who opened the wizard and backed out left that row
 * behind, so the dashboard grew nameless drafts nobody had chosen to create
 * -- and a host could not tell two of them apart to delete the right one. A
 * row now exists only once the host has said what it is.
 *
 * It also creates the HostProfile if this is the host's first spot, which is
 * why the route behind it is not gated on being a host: this is the request
 * that makes someone one. Both go in one transaction, so a failure cannot
 * leave a profile with nothing in it.
 */
export async function createSpot(userId: string, input: CreateSpotInput) {
  const hostProfileId = await hostService.ensureProfile(userId);

  return prisma.listing.create({
    data: {
      hostProfileId,
      listingType: "INDEPENDENT_SPOT",
      name: input.name,
      venueName: input.venueName,
      spaceType: input.spaceType,
      description: input.description || null,
      // DRAFT, not PUBLISHED. Naming a spot opens it; it does not make it
      // bookable. Going live needs the rest of the wizard, an admin accepting
      // the ownership document, and an active payout account -- publishing
      // here would route drivers and their money to a space nobody has
      // checked and a host nobody can pay.
      status: "DRAFT",
      createdBy: userId,
      updatedBy: userId,
    },
    select: spotView,
  });
}

/** Step 1 (of the per-spot wizard). What kind of space this is, and its name. */
export async function saveType(
  listingId: string,
  hostProfileId: string,
  userId: string,
  input: CreateSpotInput
) {
  await editableSpot(listingId, hostProfileId);

  return prisma.listing.update({
    where: { id: listingId },
    data: {
      name: input.name,
      venueName: input.venueName,
      spaceType: input.spaceType,
      ...(input.description !== undefined ? { description: input.description || null } : {}),
      updatedBy: userId,
    },
    select: spotView,
  });
}

/**
 * Taking a spot off the host's own dashboard. A cancel, not a row deletion --
 * the same pattern account deletion already uses for a host's listings -- so
 * booking history (once host spots can be booked) and the review record
 * survive, and only its visibility does not. Availability is switched off
 * alongside it, or a re-published listing would show windows that were never
 * really turned off.
 *
 * Allowed from any status, not just the editable ones: a host who wants a
 * live spot gone should not have to wait for support, and there is nothing
 * for `editableSpot`'s "under review" / "live, contact support" refusal to
 * protect here -- unlike an edit, a delete cannot corrupt something a human
 * already checked.
 */
export async function deleteListing(
  listingId: string,
  hostProfileId: string,
  userId: string
) {
  const spot = await ownedSpot(listingId, hostProfileId);

  if (spot.status === "CANCELLED") return;

  await prisma.$transaction([
    prisma.listing.update({
      where: { id: listingId },
      data: { status: "CANCELLED", updatedBy: userId },
    }),
    prisma.hostAvailability.updateMany({
      where: { listingId },
      data: { isActive: false },
    }),
  ]);
}

/**
 * Step 3. The pin is what a driver navigates to.
 *
 * Written onto the listing only. It used to also update HostProfile, back
 * when a host had one spot and the two addresses were the same fact twice;
 * now that a host can have several spots at different addresses, the last one
 * saved would otherwise silently overwrite the host's own registered address
 * on every unrelated spot's edit.
 */
export async function saveAddress(
  listingId: string,
  hostProfileId: string,
  userId: string,
  input: SaveAddressInput
) {
  await editableSpot(listingId, hostProfileId);

  const current = await prisma.listing.findUniqueOrThrow({
    where: { id: listingId },
    select: { latitude: true, longitude: true, pinConfirmedAt: true },
  });

  // The one line older readers show, from the parts in the order an Indian
  // address is written: house, society, street.
  const composed = [input.building, input.societyName, input.street]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");
  const addressLine = composed || input.addressLine?.trim() || null;

  if (!addressLine) {
    throw badRequest("Add the street, or the society or building name");
  }

  // A pin counts as placed only when the host placed it. A search result is
  // the middle of an area; moving the point without saying so un-places it.
  const moved =
    current.latitude === null ||
    current.longitude === null ||
    !current.latitude.equals(input.latitude) ||
    !current.longitude.equals(input.longitude);
  const pinConfirmedAt =
    input.pinConfirmed === true
      ? moved || !current.pinConfirmedAt
        ? new Date()
        : current.pinConfirmedAt
      : input.pinConfirmed === false || moved
        ? null
        : current.pinConfirmedAt;

  return prisma.listing.update({
    where: { id: listingId },
    data: {
      addressLine,
      ...(input.societyName !== undefined ? { societyName: input.societyName || null } : {}),
      ...(input.building !== undefined ? { building: input.building || null } : {}),
      ...(input.street !== undefined ? { street: input.street || null } : {}),
      ...(input.area !== undefined ? { area: input.area || null } : {}),
      city: input.city,
      state: input.state,
      pincode: input.pincode,
      latitude: new Prisma.Decimal(input.latitude),
      longitude: new Prisma.Decimal(input.longitude),
      googlePlaceId: input.googlePlaceId,
      pinConfirmedAt,
      updatedBy: userId,
    },
    select: spotView,
  });
}

/**
 * Steps 4 and 7. Mints an upload URL; the bytes go straight to the object
 * store and never through this server.
 *
 * The content type is checked here rather than after the fact because the
 * presigned URL is what grants the write -- once it is handed out, whatever
 * the client PUTs is what lands in the bucket.
 */
export async function presignUpload(
  listingId: string,
  hostProfileId: string,
  kind: "photo" | "ownership-doc",
  input: PresignInput
) {
  if (kind === "photo") await operableSpot(listingId, hostProfileId);
  else await editableSpot(listingId, hostProfileId);

  const allowed =
    kind === "photo" ? IMAGE_CONTENT_TYPES : DOCUMENT_CONTENT_TYPES;

  if (!allowed.includes(input.contentType)) {
    throw badRequest(`Unsupported file type. Allowed: ${allowed.join(", ")}`);
  }

  if (input.contentLength > env.MAX_UPLOAD_BYTES) {
    throw badRequest(
      `File is too large. Maximum ${Math.floor(env.MAX_UPLOAD_BYTES / 1024 / 1024)}MB`
    );
  }

  return getStorageProvider().presignUpload({
    prefix: kind === "photo" ? `spot-photos/${listingId}` : `ownership-docs/${listingId}`,
    contentType: input.contentType,
    contentLength: input.contentLength,
  });
}

/**
 * Step 4, part two. Attaches URLs the client says it uploaded.
 *
 * Every URL is checked against the storage provider first. The client reports
 * these back to us, so without that check a host could attach any URL on the
 * internet and we would serve it to drivers as a photo of their spot.
 */
export async function replacePhotos(
  listingId: string,
  hostProfileId: string,
  urls: string[]
) {
  const spot = await operableSpot(listingId, hostProfileId);

  if (urls.length > MAX_PHOTOS) {
    throw badRequest(`At most ${MAX_PHOTOS} photos`);
  }

  // A draft fills up one photo at a time; a live listing keeps its minimum
  // (or what it had, if it went live with fewer before the minimum existed).
  if (!EDITABLE_STATUSES.includes(spot.status)) {
    const had = await prisma.spotPhoto.count({ where: { listingId } });
    if (urls.length < Math.min(MIN_PHOTOS, had)) {
      throw badRequest(`A live listing needs at least ${MIN_PHOTOS} photos. Add one before removing this.`);
    }
  }

  const storage = getStorageProvider();
  const foreign = urls.filter((url) => !storage.ownsUrl(url));

  if (foreign.length > 0) {
    throw badRequest("Photos must be uploaded through the provided upload URL");
  }

  await prisma.$transaction([
    prisma.spotPhoto.deleteMany({ where: { listingId } }),
    prisma.spotPhoto.createMany({
      data: urls.map((url, position) => ({ listingId, url, position })),
    }),
  ]);

  return getForHost(listingId, hostProfileId);
}

/** Step 7. The document a human checks before the spot may go live. */
export async function saveOwnershipDoc(
  listingId: string,
  hostProfileId: string,
  userId: string,
  url: string
) {
  await editableSpot(listingId, hostProfileId);

  if (!getStorageProvider().ownsUrl(url)) {
    throw badRequest("Document must be uploaded through the provided upload URL");
  }

  return prisma.listing.update({
    where: { id: listingId },
    data: { ownershipDocUrl: url, updatedBy: userId },
    select: spotView,
  });
}

/** Steps 6 and 8: how to get in, and the host's warranty that they may let you. */
export async function saveTerms(
  listingId: string,
  hostProfileId: string,
  userId: string,
  input: {
    accessInstructions?: string;
    entryPoint?: string;
    warrantyAccepted?: boolean;
    entryMethod?: string | null;
    bayNumber?: string | null;
    parkingMarker?: string | null;
  }
) {
  await operableSpot(listingId, hostProfileId);

  return prisma.listing.update({
    where: { id: listingId },
    data: {
      ...(input.accessInstructions !== undefined
        ? { accessInstructions: input.accessInstructions }
        : {}),
      ...(input.entryPoint !== undefined ? { entryPoint: input.entryPoint || null } : {}),
      ...(input.entryMethod !== undefined ? { entryMethod: input.entryMethod } : {}),
      ...(input.bayNumber !== undefined ? { bayNumber: input.bayNumber || null } : {}),
      ...(input.parkingMarker !== undefined ? { parkingMarker: input.parkingMarker || null } : {}),
      // Recorded as an instant, and only ever set forward. Un-ticking the box
      // after the fact should not erase that it was ticked.
      ...(input.warrantyAccepted ? { warrantyAcceptedAt: new Date() } : {}),
      updatedBy: userId,
    },
    select: spotView,
  });
}

/**
 * Whether an error is the availability exclusion constraint firing.
 *
 * Matched on the message because Prisma does not model Postgres' 23P01: it
 * arrives as PrismaClientUnknownRequestError, with both the code and the
 * constraint name only in the text. Both are checked so a rename of either
 * one does not silently turn a 400 back into a 500.
 */
function isOverlapViolation(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientUnknownRequestError) &&
    !(error instanceof Prisma.PrismaClientKnownRequestError)
  ) {
    return false;
  }

  const message = String(error.message);

  return (
    message.includes("23P01") || message.includes("HostAvailability_no_overlap")
  );
}

/**
 * Step 5. Replaces this spot's whole weekly schedule.
 *
 * A replace rather than a merge: the wizard shows the full week, so what it
 * sends is the truth. Overlaps inside the payload are caught by the database's
 * exclusion constraint, not by a loop here -- see migration
 * 0012_create_host_availability.
 *
 * Bookings already made are never touched by new hours: a driver who paid
 * keeps their time. What the host is told instead is how many paid stays now
 * fall outside the hours, so the change is never silent.
 */
export async function replaceAvailability(
  listingId: string,
  hostProfileId: string,
  windows: AvailabilityWindowInput[]
) {
  await operableSpot(listingId, hostProfileId);

  try {
    await prisma.$transaction([
      prisma.hostAvailability.deleteMany({ where: { listingId } }),
      prisma.hostAvailability.createMany({
        data: windows.map((window) => ({ listingId, ...window })),
      }),
    ]);
  } catch (error) {
    // 23P01 is exclusion_violation. Prisma has no typed code for it: it
    // surfaces as PrismaClientUnknownRequestError with the Postgres code
    // buried in the message, so the message is what there is to match on.
    if (isOverlapViolation(error)) {
      throw badRequest("Two of these time windows overlap on the same day");
    }

    throw error;
  }

  return { ...(await getForHost(listingId, hostProfileId)), outsideHours: await outsideHours(listingId, windows) };
}

/** Paid stays still to come that these hours don't cover. */
async function outsideHours(listingId: string, windows: AvailabilityWindowInput[]) {
  const now = new Date();
  const stays = await prisma.booking.findMany({
    where: { listingId, status: "CONFIRMED", endsAt: { gt: now } },
    select: { startsAt: true, endsAt: true },
  });
  const covered = (start: Date, end: Date) => windowsCover(windows, start, end);
  return {
    bookings: stays.filter((b) => b.startsAt && b.endsAt && !covered(b.startsAt < now ? now : b.startsAt, b.endsAt)).length,
  };
}

/**
 * Step 6. One row per vehicle type, replacing whatever was there.
 *
 * Either rate may be missing -- a daily-only space has no hourly rate -- but
 * not both. Rows must be for the vehicle types the host
 * said can park (Parking details): a price for bikes on a car-only space
 * would put it in bike searches it can't serve. New prices apply to new
 * bookings; a booking keeps the amount it was made at.
 */
export async function replacePricing(
  listingId: string,
  hostProfileId: string,
  rows: PricingRowInput[]
) {
  await operableSpot(listingId, hostProfileId);

  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.vehicleType)) {
      throw badRequest(`Two rates given for ${row.vehicleType}`);
    }
    if (row.pricePerHour === undefined && row.pricePerDay === undefined) {
      throw badRequest(`Set at least one price for ${row.vehicleType === "BIKE" ? "bikes" : "cars"}`);
    }
    seen.add(row.vehicleType);
  }

  const { vehicleTypes } = await prisma.listing.findUniqueOrThrow({ where: { id: listingId }, select: { vehicleTypes: true } });
  if (vehicleTypes.length > 0) {
    const stray = rows.find((row) => !vehicleTypes.includes(row.vehicleType));
    if (stray) throw badRequest("Add that vehicle type in Parking details before pricing it");
    const unpriced = vehicleTypes.find((type) => !seen.has(type));
    if (unpriced) throw badRequest(`Set a price for ${unpriced === "BIKE" ? "bikes" : "cars"}`);
  }

  const decimal = (value: number | undefined) => (value !== undefined ? new Prisma.Decimal(value) : null);

  await prisma.$transaction([
    prisma.spotPricing.deleteMany({ where: { listingId } }),
    prisma.spotPricing.createMany({
      data: rows.map((row) => ({
        listingId,
        vehicleType: row.vehicleType,
        pricePerHour: decimal(row.pricePerHour),
        pricePerDay: decimal(row.pricePerDay),
      })),
    }),
  ]);

  return getForHost(listingId, hostProfileId);
}

/** One thing still to do, and the wizard step that does it. */
export interface ReadinessItem {
  step: string;
  message: string;
}

/**
 * What is still missing before this spot can be submitted.
 *
 * Returned as a list rather than thrown one at a time: a host who is three
 * fields short should be told all three, not made to submit three times. Each
 * names its step so the review screen can take the host straight there.
 */
export async function readiness(listingId: string, hostProfileId: string): Promise<ReadinessItem[]> {
  const spot = await prisma.listing.findFirst({
    where: { id: listingId, hostProfileId, listingType: "INDEPENDENT_SPOT" },
    select: {
      name: true,
      spaceType: true,
      latitude: true,
      longitude: true,
      pinConfirmedAt: true,
      addressLine: true,
      area: true,
      city: true,
      pincode: true,
      vehicleTypes: true,
      accessInstructions: true,
      entryMethod: true,
      ownershipDocUrl: true,
      ownershipDocType: true,
      permissionBasis: true,
      inSociety: true,
      societyPermissionAt: true,
      warrantyAcceptedAt: true,
      pricing: { select: { vehicleType: true, pricePerHour: true, pricePerDay: true } },
      hostProfile: { select: { payoutKycStatus: true, payoutAccountNumber: true } },
      _count: { select: { photos: true } },
    },
  });

  if (!spot) {
    throw notFound("Spot not found");
  }

  const windows = await prisma.hostAvailability.count({
    where: { listingId, isActive: true },
  });

  const items: ReadinessItem[] = [];
  const need = (step: string, message: string) => items.push({ step, message });

  if (!spot.spaceType) need("type", "Choose the type of space");
  if (!spot.name.trim()) need("type", "Name your listing");

  if (spot.latitude === null || spot.longitude === null || !spot.pinConfirmedAt) {
    need("address", "Place the pin on the map where drivers should park");
  }
  if (!spot.addressLine || !spot.area || !spot.city || !spot.pincode) need("address", "Complete the address");

  if (spot._count.photos < MIN_PHOTOS) {
    need("photos", spot._count.photos === 1 ? "Add at least one more photo" : `Add at least ${MIN_PHOTOS} photos`);
  }

  // Older listings predate the list; their priced types are the answer.
  const vehicleTypes = spot.vehicleTypes.length ? spot.vehicleTypes : spot.pricing.map((row) => row.vehicleType);
  // Covered or open is answered with the vehicles (saveDetails requires it),
  // so a saved vehicle list means the details step was completed.
  if (vehicleTypes.length === 0) need("details", "Choose which vehicles can park");

  if (windows === 0) need("availability", "Set when drivers can book");

  for (const type of vehicleTypes) {
    const row = spot.pricing.find((r) => r.vehicleType === type);
    if (!row || (!row.pricePerHour && !row.pricePerDay)) {
      need("pricing", `Set a price for ${type === "BIKE" ? "bikes" : "cars"}`);
    }
  }

  if (!spot.entryMethod) need("access", "Choose how drivers get in");
  if (!spot.accessInstructions) need("access", "Add your access instructions");

  if (!spot.ownershipDocUrl) need("documents", "Attach your ownership or permission document");
  else if (!spot.ownershipDocType) need("documents", "Say what the document is");
  if (!spot.permissionBasis || !spot.warrantyAcceptedAt) need("documents", "Confirm you own the space or have the owner's permission");
  if (spot.inSociety === null) need("documents", "Say whether the space is in a housing society");
  else if (spot.inSociety && !spot.societyPermissionAt) need("documents", "Confirm your society or RWA's permission");

  const payout = spot.hostProfile;
  const payoutReady =
    payout?.payoutKycStatus === "ACTIVATED" ||
    (Boolean(payout?.payoutAccountNumber) && payout?.payoutKycStatus !== "REJECTED");
  if (!payoutReady) {
    need("payout", payout?.payoutKycStatus === "REJECTED" ? "Fix your payout details" : "Add a payout account");
  }

  return items;
}

/** The same list as plain sentences, for the submit refusal. */
export async function missingForSubmit(listingId: string, hostProfileId: string): Promise<string[]> {
  return (await readiness(listingId, hostProfileId)).map((item) => item.message);
}

/**
 * Step 10. Hands the spot to review.
 *
 * Note what this does NOT do: publish. Submitting is the host saying they are
 * finished, not the platform agreeing. PUBLISHED is an admin's decision, and
 * it also waits on the payout account -- see admin-spot.service.
 */
export async function submit(
  listingId: string,
  hostProfileId: string,
  userId: string
) {
  await editableSpot(listingId, hostProfileId);

  const missing = await missingForSubmit(listingId, hostProfileId);

  if (missing.length > 0) {
    throw badRequest(`Still needed before submitting: ${missing.join("; ")}`);
  }

  const submitted = await prisma.listing.update({
    where: { id: listingId },
    data: {
      status: "PENDING_REVIEW",
      submittedAt: new Date(),
      // A resubmission after a rejection starts clean, or the host would see
      // last round's reason next to their new submission.
      rejectionReason: null,
      rejectionSection: null,
      reviewedAt: null,
      reviewedBy: null,
      updatedBy: userId,
    },
    select: spotView,
  });

  audit("LISTING_SUBMITTED", { userId, listingId });
  return submitted;
}

/** Wizard (dashboard "Amenities"): what the space offers. Kept for older screens; the wizard uses saveDetails. */
export async function saveFeatures(listingId: string, hostProfileId: string, userId: string, amenities: string[]) {
  await operableSpot(listingId, hostProfileId);
  return prisma.listing.update({
    where: { id: listingId },
    data: { amenities: [...new Set(amenities)], updatedBy: userId },
    select: spotView,
  });
}

/** Wizard (older): what fits, and the host's own rules. Null clears a limit. */
export async function saveLimits(
  listingId: string,
  hostProfileId: string,
  userId: string,
  input: { maxVehicleHeightCm?: number | null; maxVehicleSize?: string | null; rules?: string | null }
) {
  await operableSpot(listingId, hostProfileId);
  return prisma.listing.update({
    where: { id: listingId },
    data: { ...input, updatedBy: userId },
    select: spotView,
  });
}

/**
 * Step 4, Parking details: covered or open, amenities, which vehicles, and
 * what fits.
 *
 * SUVs and vans are sizes of car, so the vehicle list is CAR / BIKE and the
 * largest car is `maxVehicleSize`. A vehicle type taken away loses its prices
 * in the same transaction, or the space would stay in searches for a vehicle
 * the host just said can't park there.
 */
export async function saveDetails(listingId: string, hostProfileId: string, userId: string, input: SaveDetailsInput) {
  await operableSpot(listingId, hostProfileId);

  const amenities = [...new Set(input.amenities.filter((a) => a !== "COVERED"))];
  if (input.covered) amenities.push("COVERED");
  const takesCars = input.vehicleTypes.includes("CAR");

  const [, updated] = await prisma.$transaction([
    prisma.spotPricing.deleteMany({ where: { listingId, vehicleType: { notIn: input.vehicleTypes } } }),
    prisma.listing.update({
      where: { id: listingId },
      data: {
        amenities,
        amenityNote: input.amenityNote || null,
        vehicleTypes: [...new Set(input.vehicleTypes)],
        maxVehicleSize: takesCars ? input.maxVehicleSize : null,
        maxVehicleHeightCm: input.maxVehicleHeightCm,
        bayWidthCm: input.bayWidthCm,
        bayLengthCm: input.bayLengthCm,
        rules: input.notes || null,
        updatedBy: userId,
      },
      select: spotView,
    }),
  ]);
  return updated;
}

/**
 * Step 5, booking rules. Optional; null leaves the platform's own limits.
 * Changing them never touches bookings already made -- they are checked when
 * a stay is quoted, booked or extended.
 */
export async function saveBookingRules(listingId: string, hostProfileId: string, userId: string, input: BookingRulesInput) {
  await operableSpot(listingId, hostProfileId);
  return prisma.listing.update({
    where: { id: listingId },
    data: { ...input, updatedBy: userId },
    select: spotView,
  });
}

/**
 * Step 8, the permission half: what the document is, whether the host owns
 * the space or has the owner's permission, and -- in a housing society or
 * RWA-managed property -- that body's permission too. Confirmations are
 * stored as instants: consent is evidence, and evidence needs a date.
 */
export async function savePermission(listingId: string, hostProfileId: string, userId: string, input: PermissionInput) {
  await editableSpot(listingId, hostProfileId);

  if (input.inSociety && !input.societyPermission) {
    throw badRequest("Confirm you have your society or RWA's permission to rent this space");
  }

  const now = new Date();
  return prisma.listing.update({
    where: { id: listingId },
    data: {
      ownershipDocType: input.ownershipDocType,
      permissionBasis: input.permissionBasis,
      inSociety: input.inSociety,
      societyPermissionAt: input.inSociety ? now : null,
      warrantyAcceptedAt: now,
      updatedBy: userId,
    },
    select: spotView,
  });
}

/**
 * The ownership document's file, for its host or an admin (hostProfileId
 * null). Never through the public upload URL -- see storage PRIVATE_PREFIXES.
 */
export async function ownershipDocumentFile(listingId: string, hostProfileId: string | null) {
  const spot = await prisma.listing.findFirst({
    where: { id: listingId, listingType: "INDEPENDENT_SPOT", ...(hostProfileId ? { hostProfileId } : {}) },
    select: { ownershipDocUrl: true },
  });
  if (!spot?.ownershipDocUrl) throw notFound("Document not found");

  const local = getLocalStorage();
  const key = local?.keyOf(spot.ownershipDocUrl);
  const path = key ? local!.resolvePath(key) : null;
  if (!path) throw notFound("Document not found");
  return path;
}
