-- Migration: Create the Booking table -- a driver's claim on a stretch of time on a host's space

CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "listingId" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "holdExpiresAt" TIMESTAMP(3),
    "extendsBookingId" TEXT,
    "driverId" TEXT NOT NULL,
    "vehicleNumber" TEXT NOT NULL,
    "vehicleType" TEXT,
    "quantity" INTEGER NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "platformFee" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "qrToken" TEXT NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Booking_idempotencyKey_key" ON "Booking"("idempotencyKey");
CREATE UNIQUE INDEX "Booking_qrToken_key" ON "Booking"("qrToken");
CREATE INDEX "Booking_listingId_startsAt_idx" ON "Booking"("listingId", "startsAt");
CREATE INDEX "Booking_driverId_idx" ON "Booking"("driverId");
CREATE INDEX "Booking_driverId_status_idx" ON "Booking"("driverId", "status");
CREATE INDEX "Booking_extendsBookingId_idx" ON "Booking"("extendsBookingId");
CREATE INDEX "Booking_createdBy_idx" ON "Booking"("createdBy");
CREATE INDEX "Booking_updatedBy_idx" ON "Booking"("updatedBy");

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_extendsBookingId_fkey" FOREIGN KEY ("extendsBookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A booking is a stretch of time on one host's space: the listing and both
-- ends are required and the stay runs forwards. (It also allowed an event
-- booking -- a slot from a ParkingCapacity -- until event parking was removed
-- on 2026-09-27; the name is kept so nothing that refers to it breaks.)
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_one_target" CHECK (
    "listingId" IS NOT NULL
    AND "startsAt" IS NOT NULL
    AND "endsAt" IS NOT NULL
    AND "endsAt" > "startsAt"
);

-- Already created with HostAvailability; repeated so this table does not
-- depend on that migration having run first.
CREATE EXTENSION IF NOT EXISTS btree_gist;

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
