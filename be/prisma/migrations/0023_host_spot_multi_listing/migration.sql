-- Migration: A host can list more than one spot
-- Created at: 2026-09-21
--
-- The wizard (migration 0022) was built for one spot per host: availability
-- hung off HostProfile, and a spot's address text was saved onto HostProfile
-- too, because there was only ever one row to put it on. Two spots at two
-- different addresses cannot share one calendar of hours or one address, so
-- both move onto the listing they actually describe.
--
-- Existing data has at most one INDEPENDENT_SPOT listing per host (the wizard
-- enforced that), so the backfill below is unambiguous.

-- ---------------------------------------------------------------- Listing --

ALTER TABLE "Listing" ADD COLUMN "addressLine" TEXT;
ALTER TABLE "Listing" ADD COLUMN "city" TEXT;
ALTER TABLE "Listing" ADD COLUMN "state" TEXT;
ALTER TABLE "Listing" ADD COLUMN "pincode" TEXT;

UPDATE "Listing" l
SET "addressLine" = hp."addressLine",
    "city" = hp."city",
    "state" = hp."state",
    "pincode" = hp."pincode"
FROM "HostProfile" hp
WHERE l."hostProfileId" = hp."id";

-- ------------------------------------------------------- HostAvailability --

ALTER TABLE "HostAvailability" ADD COLUMN "listingId" TEXT;

UPDATE "HostAvailability" ha
SET "listingId" = l."id"
FROM "Listing" l
WHERE l."hostProfileId" = ha."hostProfileId";

-- Every existing host had at most one listing, so this must have matched a
-- row for all of them; a NULL here means that assumption did not hold and the
-- migration should stop rather than drop data silently.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "HostAvailability" WHERE "listingId" IS NULL) THEN
    RAISE EXCEPTION 'HostAvailability rows with no matching Listing -- backfill failed';
  END IF;
END $$;

ALTER TABLE "HostAvailability" ALTER COLUMN "listingId" SET NOT NULL;

-- The overlap guard has to move with the column it constrains: an EXCLUDE
-- constraint scoped to hostProfileId would refuse a second spot's Tuesday
-- 9-12 window for colliding with the first spot's, which is not a collision
-- at all.
ALTER TABLE "HostAvailability" DROP CONSTRAINT "HostAvailability_no_overlap";

ALTER TABLE "HostAvailability" DROP CONSTRAINT "HostAvailability_hostProfileId_fkey";
DROP INDEX "HostAvailability_hostProfileId_idx";
ALTER TABLE "HostAvailability" DROP COLUMN "hostProfileId";

ALTER TABLE "HostAvailability" ADD CONSTRAINT "HostAvailability_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "HostAvailability_listingId_idx" ON "HostAvailability"("listingId");

ALTER TABLE "HostAvailability" ADD CONSTRAINT "HostAvailability_no_overlap"
    EXCLUDE USING gist (
        "listingId" WITH =,
        "dayOfWeek" WITH =,
        int4range("startMinute", "endMinute") WITH &&
    ) WHERE ("isActive" = true);
