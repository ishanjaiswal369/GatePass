-- Migration: Book a host's spot by the hour
-- Created at: 2026-09-23
--
-- A Booking has always been a claim on a ParkingCapacity: a count of
-- interchangeable slots at a dated event, guarded against overselling by a
-- conditional UPDATE on bookedCount. A host's spot is not that. It is one
-- space, and what two drivers compete for is not a slot but a stretch of
-- time -- so "is it free" is a question about ranges, and a counter cannot
-- answer it.
--
-- So a booking gains an optional listing and a time range, and the guard
-- becomes an EXCLUDE constraint. The two shapes stay in one table because
-- everything downstream of a booking -- payments, passes, settlement items --
-- is the same either way, and splitting them would double every one of those.

-- ------------------------------------------------------------ the shapes --

ALTER TABLE "Booking" ALTER COLUMN "parkingCapacityId" DROP NOT NULL;

ALTER TABLE "Booking" ADD COLUMN "listingId" TEXT;
ALTER TABLE "Booking" ADD COLUMN "startsAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN "endsAt" TIMESTAMP(3);

-- When an unpaid hold stops holding the space. Until payments exist, every
-- booking is created PENDING and would otherwise block that driveway for
-- ever; with this, a hold that nobody paid for is released on the next
-- booking attempt for the same spot. This is the same gap the event flow has
-- and has not fixed -- see section 9 of IMPLEMENTATION.md -- closed here
-- because a single space has no spare capacity to absorb it.
ALTER TABLE "Booking" ADD COLUMN "holdExpiresAt" TIMESTAMP(3);

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exactly one of the two shapes, never a mixture and never neither. Written
-- as one CHECK rather than three so a row cannot satisfy each rule separately
-- and still be nonsense.
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_one_target" CHECK (
    (
        "parkingCapacityId" IS NOT NULL
        AND "listingId" IS NULL
        AND "startsAt" IS NULL
        AND "endsAt" IS NULL
    )
    OR
    (
        "parkingCapacityId" IS NULL
        AND "listingId" IS NOT NULL
        AND "startsAt" IS NOT NULL
        AND "endsAt" IS NOT NULL
        AND "endsAt" > "startsAt"
    )
);

-- -------------------------------------------------------- the real guard --

-- The oversell guard for a space that cannot be oversold by one. Two drivers
-- asking for overlapping hours is exactly the race a popular spot produces,
-- and a read-then-write check in application code loses it: both transactions
-- read "free" before either writes. The database refuses the second insert.
--
-- Scoped by the WHERE so a cancelled or completed booking stops reserving the
-- time -- which is also what releases an expired hold, since the sweeper
-- cancels it rather than deleting it.
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_no_overlap"
    EXCLUDE USING gist (
        "listingId" WITH =,
        tsrange("startsAt", "endsAt") WITH &&
    ) WHERE ("listingId" IS NOT NULL AND "status" IN ('PENDING', 'CONFIRMED'));

-- Drives both the "what is booked on this spot" read and the hold sweep.
CREATE INDEX "Booking_listingId_startsAt_idx" ON "Booking"("listingId", "startsAt");
