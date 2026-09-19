-- Migration: Weekly availability windows for host spots
-- Created at: 2026-09-19
--
-- ParkingCapacity cannot carry this. It models a fixed number of slots for one
-- fixed date -- right for an event, wrong for a driveway that is free every
-- Tuesday evening. A host offers the same single space again each week, so the
-- unit is a weekly window with an hourly price, and the booking amount is
-- pricePerHour x duration rather than a per-slot price.
--
-- Times are minutes from midnight rather than timestamps because they are
-- times of day, not instants: 18:00 stays 18:00 across a DST-free year and
-- across every date the window repeats on.

CREATE TABLE "HostAvailability" (
    "id" TEXT NOT NULL,
    "hostProfileId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "pricePerHour" DECIMAL(65, 30) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HostAvailability_pkey" PRIMARY KEY ("id")
);

-- 0 = Sunday .. 6 = Saturday, matching JS getDay(). Checked here as well as in
-- zod: a window on "day 9" is silently invisible forever, which is the kind of
-- bug that gets found by a host complaining months later.
ALTER TABLE "HostAvailability" ADD CONSTRAINT "HostAvailability_dayOfWeek_range"
    CHECK ("dayOfWeek" >= 0 AND "dayOfWeek" <= 6);

-- A window that ends before it starts would match nothing; one past midnight
-- must be stored as two rows.
ALTER TABLE "HostAvailability" ADD CONSTRAINT "HostAvailability_minute_range"
    CHECK ("startMinute" >= 0 AND "endMinute" <= 1440 AND "startMinute" < "endMinute");

CREATE INDEX "HostAvailability_hostProfileId_idx" ON "HostAvailability"("hostProfileId");
CREATE INDEX "HostAvailability_dayOfWeek_isActive_idx" ON "HostAvailability"("dayOfWeek", "isActive");

ALTER TABLE "HostAvailability" ADD CONSTRAINT "HostAvailability_hostProfileId_fkey"
    FOREIGN KEY ("hostProfileId") REFERENCES "HostProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
