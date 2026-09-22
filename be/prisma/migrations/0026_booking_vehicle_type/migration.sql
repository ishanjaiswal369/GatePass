-- Migration: Record which vehicle type a booking was made for
-- Created at: 2026-09-23
--
-- An event booking reaches its vehicle type through ParkingCapacity, which is
-- where the rate for it lives. A host-spot booking has no ParkingCapacity: it
-- picks a rate out of SpotPricing and then had nowhere to record which one it
-- picked. The amount survives, so the money is recoverable, but "what was
-- booked" was not -- and the pass, the host's own view of what is arriving,
-- and any later dispute all want it.
--
-- Nullable because every existing row is an event booking that already
-- answers this through its capacity.

ALTER TABLE "Booking" ADD COLUMN "vehicleType" TEXT;
