-- Migration: Create the HostAvailability table -- the weekly hours a host's spot can be booked

CREATE TABLE "HostAvailability" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HostAvailability_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HostAvailability_listingId_idx" ON "HostAvailability"("listingId");
CREATE INDEX "HostAvailability_dayOfWeek_isActive_idx" ON "HostAvailability"("dayOfWeek", "isActive");

ALTER TABLE "HostAvailability" ADD CONSTRAINT "HostAvailability_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 0 = Sunday .. 6 = Saturday, matching JS getDay(). Checked here as well as in
-- zod: a window on "day 9" is silently invisible forever, which is the kind of
-- bug that gets found by a host complaining months later.
ALTER TABLE "HostAvailability" ADD CONSTRAINT "HostAvailability_dayOfWeek_range"
    CHECK ("dayOfWeek" >= 0 AND "dayOfWeek" <= 6);

-- A window that ends before it starts would match nothing; one past midnight
-- must be stored as two rows.
ALTER TABLE "HostAvailability" ADD CONSTRAINT "HostAvailability_minute_range"
    CHECK ("startMinute" >= 0 AND "endMinute" <= 1440 AND "startMinute" < "endMinute");

-- btree_gist is what lets a gist index mix plain equality columns with a
-- range overlap operator. Booking_no_overlap needs it too.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Overlapping windows on one spot, same weekday, refused by the database.
--
-- Scoped to the listing, not the host: a host's second spot open Tuesday 9-12
-- does not collide with their first spot's Tuesday 9-12.
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
        "listingId" WITH =,
        "dayOfWeek" WITH =,
        int4range("startMinute", "endMinute") WITH &&
    ) WHERE ("isActive" = true);
