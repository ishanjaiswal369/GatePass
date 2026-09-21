-- Migration: A host can list more than one spot
-- Created at: 2026-09-21
--
-- Host onboarding used to create exactly one Listing per HostProfile, and
-- HostAvailability hung off the HostProfile on that assumption -- one set of
-- hours and one price for "the" spot. A host with parking at two different
-- addresses could not represent that: a second Listing would either share the
-- first spot's hours or there would be nowhere to hang a second set of hours
-- at all.
--
-- This migration moves availability from the host to the listing it prices,
-- and gives a listing its own address/city/pincode instead of borrowing the
-- host's (which is one row per host, not per spot). Existing data has exactly
-- one INDEPENDENT_SPOT listing per host, so the backfill is unambiguous.

-- 1. A host spot's own location, not the host's registered one.
ALTER TABLE "Listing" ADD COLUMN "addressLine" TEXT;
ALTER TABLE "Listing" ADD COLUMN "city" TEXT;
ALTER TABLE "Listing" ADD COLUMN "pincode" TEXT;

UPDATE "Listing" l
SET "addressLine" = hp."addressLine",
    "city" = hp."city",
    "pincode" = hp."pincode"
FROM "HostProfile" hp
WHERE l."hostProfileId" = hp."id";

-- 2. HostAvailability moves from hostProfileId to listingId.
ALTER TABLE "HostAvailability" ADD COLUMN "listingId" TEXT;

UPDATE "HostAvailability" ha
SET "listingId" = l."id"
FROM "Listing" l
WHERE l."hostProfileId" = ha."hostProfileId";

-- Every existing host had exactly one listing, so this must have matched a
-- row for all of them; a NULL here means that assumption did not hold and the
-- migration should stop rather than drop data silently.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "HostAvailability" WHERE "listingId" IS NULL) THEN
    RAISE EXCEPTION 'HostAvailability rows with no matching Listing -- backfill failed';
  END IF;
END $$;

ALTER TABLE "HostAvailability" ALTER COLUMN "listingId" SET NOT NULL;

ALTER TABLE "HostAvailability" DROP CONSTRAINT "HostAvailability_hostProfileId_fkey";
DROP INDEX "HostAvailability_hostProfileId_idx";
ALTER TABLE "HostAvailability" DROP COLUMN "hostProfileId";

ALTER TABLE "HostAvailability" ADD CONSTRAINT "HostAvailability_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "HostAvailability_listingId_idx" ON "HostAvailability"("listingId");
