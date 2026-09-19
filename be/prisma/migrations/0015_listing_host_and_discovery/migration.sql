-- Migration: Host-owned listings and the indexes the driver feed needs
-- Created at: 2026-09-19
--
-- A listing now has two possible owners: an organizer (an event) or a host (an
-- INDEPENDENT_SPOT). organizerId therefore stops being NOT NULL, and a CHECK
-- takes over the job it used to do -- exactly one owner must be set, so a row
-- can never end up orphaned or owned twice.

ALTER TABLE "Listing" ALTER COLUMN "organizerId" DROP NOT NULL;

ALTER TABLE "Listing" ADD COLUMN "hostProfileId" TEXT;

ALTER TABLE "Listing" ADD CONSTRAINT "Listing_hostProfileId_fkey"
    FOREIGN KEY ("hostProfileId") REFERENCES "HostProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Listing_hostProfileId_idx" ON "Listing"("hostProfileId");

ALTER TABLE "Listing" ADD CONSTRAINT "Listing_one_owner"
    CHECK (
        ("organizerId" IS NOT NULL AND "hostProfileId" IS NULL)
        OR ("organizerId" IS NULL AND "hostProfileId" IS NOT NULL)
    );

-- Discovery indexes.
--
-- The feed always filters on status and orders by eventDate, so that pair is
-- the one index that matters; listingType splits events from host spots.
CREATE INDEX "Listing_status_eventDate_idx" ON "Listing"("status", "eventDate");
CREATE INDEX "Listing_listingType_status_idx" ON "Listing"("listingType", "status");

-- Bounding-box prefilter for radius search. This is a plain B-tree on two
-- columns, not a spatial index: Postgres can use it to cut the candidate set
-- down to a box, and the haversine distance is then computed on what survives.
-- Good enough at this size; PostGIS or earthdistance is the answer if radius
-- search ever becomes the hot path.
CREATE INDEX "Listing_latitude_longitude_idx" ON "Listing"("latitude", "longitude");

-- The driver's own booking list and the active-pass lookup both filter on
-- (driverId, status).
CREATE INDEX "Booking_driverId_status_idx" ON "Booking"("driverId", "status");
