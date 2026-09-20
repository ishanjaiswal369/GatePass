import { Prisma } from "@prisma/client";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { getStorageProvider } from "../integrations/storage/index.js";
import { env } from "../config/env.js";

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

/** Photos a host may attach to one spot. */
const MAX_PHOTOS = 8;

const IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** Ownership proof is usually a scan or a PDF bill. */
const DOCUMENT_CONTENT_TYPES = [...IMAGE_CONTENT_TYPES, "application/pdf"];

export interface CreateSpotInput {
  name: string;
  spaceType: string;
  venueName: string;
}

export interface SaveAddressInput {
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
  latitude: number;
  longitude: number;
  googlePlaceId?: string;
}

export interface AvailabilityWindowInput {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

export interface PricingRowInput {
  vehicleType: string;
  pricePerHour: number;
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
  status: true,
  latitude: true,
  longitude: true,
  googlePlaceId: true,
  accessInstructions: true,
  ownershipDocUrl: true,
  warrantyAcceptedAt: true,
  submittedAt: true,
  reviewedAt: true,
  rejectionReason: true,
  createdAt: true,
  photos: {
    select: { id: true, url: true, position: true },
    orderBy: { position: "asc" },
  },
  pricing: {
    select: { id: true, vehicleType: true, pricePerHour: true },
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

  return { ...spot, availability: await availabilityFor(hostProfileId) };
}

/**
 * Availability hangs off the host, not the listing -- a host has one spot in
 * this product, and the table predates the wizard. Read through the listing
 * anyway so the wizard has one shape to work with, and moving the rows later
 * is a service change rather than an API change.
 */
async function availabilityFor(hostProfileId: string) {
  return prisma.hostAvailability.findMany({
    where: { hostProfileId },
    select: {
      id: true,
      dayOfWeek: true,
      startMinute: true,
      endMinute: true,
      isActive: true,
    },
    orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
  });
}

/**
 * Step 1. Opens the draft, or picks up the one already there.
 *
 * Host onboarding creates this listing row before the wizard ever runs, so
 * this adopts an existing draft instead of refusing -- a host who restarts
 * the wizard is continuing, not colliding. One spot per host for now, matching
 * the rest of the product: HostProfile is 1:1 with User and carries the
 * address, so a second spot would have nowhere to put its own.
 */
export async function createDraft(
  hostProfileId: string,
  userId: string,
  input: CreateSpotInput
) {
  const existing = await prisma.listing.findFirst({
    where: {
      hostProfileId,
      listingType: "INDEPENDENT_SPOT",
      status: { notIn: ["CANCELLED"] },
    },
    select: { id: true, status: true },
  });

  if (existing && !EDITABLE_STATUSES.includes(existing.status)) {
    throw conflict(
      existing.status === "PENDING_REVIEW"
        ? "This host already has a spot under review"
        : "This host already has a live spot"
    );
  }

  if (existing) {
    return prisma.listing.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        venueName: input.venueName,
        spaceType: input.spaceType,
        status: "DRAFT",
        updatedBy: userId,
      },
      select: spotView,
    });
  }

  return prisma.listing.create({
    data: {
      hostProfileId,
      listingType: "INDEPENDENT_SPOT",
      name: input.name,
      venueName: input.venueName,
      spaceType: input.spaceType,
      status: "DRAFT",
      createdBy: userId,
      updatedBy: userId,
    },
    select: spotView,
  });
}

/**
 * Step 3. The pin is what a driver navigates to, so it is stored on the
 * listing and on the host profile: search reads the profile's coordinates,
 * and the listing keeps the exact spot the host dragged the pin to.
 */
export async function saveAddress(
  listingId: string,
  hostProfileId: string,
  userId: string,
  input: SaveAddressInput
) {
  await editableSpot(listingId, hostProfileId);

  const [spot] = await prisma.$transaction([
    prisma.listing.update({
      where: { id: listingId },
      data: {
        latitude: new Prisma.Decimal(input.latitude),
        longitude: new Prisma.Decimal(input.longitude),
        googlePlaceId: input.googlePlaceId,
        updatedBy: userId,
      },
      select: spotView,
    }),
    prisma.hostProfile.update({
      where: { id: hostProfileId },
      data: {
        addressLine: input.addressLine,
        city: input.city,
        state: input.state,
        pincode: input.pincode,
        latitude: new Prisma.Decimal(input.latitude),
        longitude: new Prisma.Decimal(input.longitude),
      },
    }),
  ]);

  return spot;
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
  await editableSpot(listingId, hostProfileId);

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
  await editableSpot(listingId, hostProfileId);

  if (urls.length > MAX_PHOTOS) {
    throw badRequest(`At most ${MAX_PHOTOS} photos`);
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
  input: { accessInstructions?: string; warrantyAccepted?: boolean }
) {
  await editableSpot(listingId, hostProfileId);

  return prisma.listing.update({
    where: { id: listingId },
    data: {
      ...(input.accessInstructions !== undefined
        ? { accessInstructions: input.accessInstructions }
        : {}),
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
 * Step 5. Replaces the host's whole weekly schedule.
 *
 * A replace rather than a merge: the wizard shows the full week, so what it
 * sends is the truth. Overlaps inside the payload are caught by the database's
 * exclusion constraint, not by a loop here -- see migration 0022.
 */
export async function replaceAvailability(
  listingId: string,
  hostProfileId: string,
  windows: AvailabilityWindowInput[]
) {
  await editableSpot(listingId, hostProfileId);

  try {
    await prisma.$transaction([
      prisma.hostAvailability.deleteMany({ where: { hostProfileId } }),
      prisma.hostAvailability.createMany({
        data: windows.map((window) => ({ hostProfileId, ...window })),
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

  return availabilityFor(hostProfileId);
}

/** Step 9. One rate per vehicle type, replacing whatever was there. */
export async function replacePricing(
  listingId: string,
  hostProfileId: string,
  rows: PricingRowInput[]
) {
  await editableSpot(listingId, hostProfileId);

  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.vehicleType)) {
      throw badRequest(`Two rates given for ${row.vehicleType}`);
    }
    seen.add(row.vehicleType);
  }

  await prisma.$transaction([
    prisma.spotPricing.deleteMany({ where: { listingId } }),
    prisma.spotPricing.createMany({
      data: rows.map((row) => ({
        listingId,
        vehicleType: row.vehicleType,
        pricePerHour: new Prisma.Decimal(row.pricePerHour),
      })),
    }),
  ]);

  return getForHost(listingId, hostProfileId);
}

/**
 * What is still missing before this spot can be submitted.
 *
 * Returned as a list rather than thrown one at a time: a host who is three
 * fields short should be told all three, not made to submit three times.
 */
export async function missingForSubmit(
  listingId: string,
  hostProfileId: string
): Promise<string[]> {
  const spot = await prisma.listing.findFirst({
    where: { id: listingId, hostProfileId, listingType: "INDEPENDENT_SPOT" },
    select: {
      spaceType: true,
      latitude: true,
      longitude: true,
      accessInstructions: true,
      ownershipDocUrl: true,
      warrantyAcceptedAt: true,
      _count: { select: { photos: true, pricing: true } },
    },
  });

  if (!spot) {
    throw notFound("Spot not found");
  }

  const windows = await prisma.hostAvailability.count({
    where: { hostProfileId, isActive: true },
  });

  const missing: string[] = [];
  if (!spot.spaceType) missing.push("space type");
  if (spot.latitude === null || spot.longitude === null) missing.push("address");
  if (spot._count.photos === 0) missing.push("at least one photo");
  if (spot._count.pricing === 0) missing.push("pricing");
  if (windows === 0) missing.push("at least one availability window");
  if (!spot.accessInstructions) missing.push("access instructions");
  if (!spot.ownershipDocUrl) missing.push("ownership proof");
  if (!spot.warrantyAcceptedAt) missing.push("permission warranty");

  return missing;
}

/**
 * Step 11. Hands the spot to review.
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
    throw badRequest(`Still needed before submitting: ${missing.join(", ")}`);
  }

  return prisma.listing.update({
    where: { id: listingId },
    data: {
      status: "PENDING_REVIEW",
      submittedAt: new Date(),
      // A resubmission after a rejection starts clean, or the host would see
      // last round's reason next to their new submission.
      rejectionReason: null,
      reviewedAt: null,
      reviewedBy: null,
      updatedBy: userId,
    },
    select: spotView,
  });
}
