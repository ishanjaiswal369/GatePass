-- Migration: Host spot listing wizard
-- Created at: 2026-09-20
--
-- Everything a host submits before their spot can be booked: what kind of
-- space it is, where exactly, photos of it, what it costs per vehicle type,
-- how a driver gets in, and proof they are allowed to rent it out.
--
-- Two gates stand between "host tapped Submit" and "driver can book":
--   1. an admin approving the ownership document (Listing.status)
--   2. the payment gateway activating their payout account
--      (HostProfile.payoutKycStatus)
-- Neither is sufficient alone. A spot that looks submitted in the app is not
-- bookable until both clear, which is why the second one is a column here
-- rather than a lookup at checkout time.

-- Needed by the EXCLUDE constraint at the bottom: btree_gist is what lets a
-- gist index mix plain equality columns with a range overlap operator.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------- Listing --

ALTER TABLE "Listing" ADD COLUMN "spaceType" TEXT;
ALTER TABLE "Listing" ADD COLUMN "googlePlaceId" TEXT;
ALTER TABLE "Listing" ADD COLUMN "accessInstructions" TEXT;
ALTER TABLE "Listing" ADD COLUMN "ownershipDocUrl" TEXT;
ALTER TABLE "Listing" ADD COLUMN "warrantyAcceptedAt" TIMESTAMP(3);
ALTER TABLE "Listing" ADD COLUMN "submittedAt" TIMESTAMP(3);
-- Doc approval is tracked apart from status because it is only one of the two
-- gates to going live; the other is the host's payout account. Either can
-- complete first, and neither publishes the listing alone.
ALTER TABLE "Listing" ADD COLUMN "docApprovedAt" TIMESTAMP(3);
ALTER TABLE "Listing" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "Listing" ADD COLUMN "reviewedBy" TEXT;
ALTER TABLE "Listing" ADD COLUMN "rejectionReason" TEXT;

ALTER TABLE "Listing" ADD CONSTRAINT "Listing_reviewedBy_fkey"
    FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Admin queue: the review screen reads exactly this.
CREATE INDEX "Listing_status_submittedAt_idx" ON "Listing"("status", "submittedAt");

-- ------------------------------------------------------------ SpotPricing --

CREATE TABLE "SpotPricing" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "vehicleType" TEXT NOT NULL,
    "pricePerHour" DECIMAL(65, 30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpotPricing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SpotPricing_listingId_vehicleType_key"
    ON "SpotPricing"("listingId", "vehicleType");

ALTER TABLE "SpotPricing" ADD CONSTRAINT "SpotPricing_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry existing prices across before the old column goes. Price used to hang
-- off each availability window, so a spot could hold several; the lowest is
-- taken, because quoting a host's own minimum is the only choice here that
-- cannot overcharge a driver who already saw that number in search.
--
-- Everything existing is priced as CAR: that is what the old single rate
-- meant in practice, and a bike rate nobody set is better absent than guessed.
INSERT INTO "SpotPricing" ("id", "listingId", "vehicleType", "pricePerHour")
SELECT
    gen_random_uuid()::text,
    l."id",
    'CAR',
    MIN(ha."pricePerHour")
FROM "Listing" l
JOIN "HostAvailability" ha ON ha."hostProfileId" = l."hostProfileId"
WHERE l."listingType" = 'INDEPENDENT_SPOT'
GROUP BY l."id";

-- -------------------------------------------------------------- SpotPhoto --

CREATE TABLE "SpotPhoto" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpotPhoto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SpotPhoto_listingId_position_idx" ON "SpotPhoto"("listingId", "position");

ALTER TABLE "SpotPhoto" ADD CONSTRAINT "SpotPhoto_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ------------------------------------------------------------ HostProfile --

ALTER TABLE "HostProfile" ADD COLUMN "payoutAccountId" TEXT;
ALTER TABLE "HostProfile" ADD COLUMN "payoutKycStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED';

-- One gateway account belongs to one host. Without this a copy-paste during
-- onboarding sends two hosts' money to the same place.
CREATE UNIQUE INDEX "HostProfile_payoutAccountId_key" ON "HostProfile"("payoutAccountId");

-- ------------------------------------------------------- HostAvailability --

ALTER TABLE "HostAvailability" DROP COLUMN "pricePerHour";

-- Overlapping windows on one spot, same weekday, refused by the database.
--
-- int4range is deliberate: these rows are recurring weekly windows held as
-- minute-of-day integers, so there is no timestamp to build a tstzrange from.
-- The default half-open bound is what makes 09:00-12:00 and 12:00-18:00 sit
-- next to each other rather than collide.
--
-- Only active windows are constrained: a host who pauses a window and adds a
-- replacement over the same hours is doing something reasonable, and blocking
-- it would force them to delete history to reschedule.
ALTER TABLE "HostAvailability" ADD CONSTRAINT "HostAvailability_no_overlap"
    EXCLUDE USING gist (
        "hostProfileId" WITH =,
        "dayOfWeek" WITH =,
        int4range("startMinute", "endMinute") WITH &&
    ) WHERE ("isActive" = true);
