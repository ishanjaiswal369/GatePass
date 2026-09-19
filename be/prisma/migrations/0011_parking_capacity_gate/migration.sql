-- Migration: Gate label on a capacity row
-- Created at: 2026-09-19
--
-- The driver's pass shows which entrance to use. The gate belongs to the
-- (listing, vehicleType) pair rather than to the listing, because bikes and
-- cars are usually sent to different entrances. Nullable: a venue with a
-- single entrance has nothing to print.

ALTER TABLE "ParkingCapacity" ADD COLUMN "gate" TEXT;
