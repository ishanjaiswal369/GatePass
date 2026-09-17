-- Migration: Replace Postgres enum types with plain TEXT columns
-- Created at: 2026-09-18
--
-- Fixed-value domains now live in src/constants/enums.ts and are enforced by
-- zod at the request boundary. Adding a new value no longer needs a migration.
--
-- Trade-off being accepted: the database no longer rejects an unrecognised
-- value. Anything writing outside the app's request layer (a manual SQL fix,
-- a future service, a bad backfill) can store a status the app will not
-- understand. The status columns on Booking, Payment and Settlement feed the
-- settlement maths, so writes to those must go through the validated paths.
--
-- Each column drops its DEFAULT first: Postgres refuses to retype a column
-- while a default referencing the old enum type is still attached.

-- User.role
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE TEXT USING "role"::TEXT;
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'DRIVER';

-- EmailVerification.deviceType (nullable, no default)
ALTER TABLE "EmailVerification"
  ALTER COLUMN "deviceType" TYPE TEXT USING "deviceType"::TEXT;

-- UserSession.deviceType
ALTER TABLE "UserSession" ALTER COLUMN "deviceType" DROP DEFAULT;
ALTER TABLE "UserSession"
  ALTER COLUMN "deviceType" TYPE TEXT USING "deviceType"::TEXT;
ALTER TABLE "UserSession" ALTER COLUMN "deviceType" SET DEFAULT 'OTHER';

-- Listing.listingType
ALTER TABLE "Listing" ALTER COLUMN "listingType" DROP DEFAULT;
ALTER TABLE "Listing"
  ALTER COLUMN "listingType" TYPE TEXT USING "listingType"::TEXT;
ALTER TABLE "Listing" ALTER COLUMN "listingType" SET DEFAULT 'EVENT';

-- Listing.status
ALTER TABLE "Listing" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Listing" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "Listing" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- ParkingCapacity.vehicleType (no default; unique index is rebuilt automatically)
ALTER TABLE "ParkingCapacity"
  ALTER COLUMN "vehicleType" TYPE TEXT USING "vehicleType"::TEXT;

-- Booking.status
ALTER TABLE "Booking" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Booking" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "Booking" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- Payment.status
ALTER TABLE "Payment" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Payment" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "Payment" ALTER COLUMN "status" SET DEFAULT 'CREATED';

-- Settlement.status
ALTER TABLE "Settlement" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Settlement" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "Settlement" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- No column references these types any more.
DROP TYPE "Role";
DROP TYPE "ListingType";
DROP TYPE "ListingStatus";
DROP TYPE "VehicleType";
DROP TYPE "BookingStatus";
DROP TYPE "PaymentStatus";
DROP TYPE "SettlementStatus";
DROP TYPE "DeviceType";
