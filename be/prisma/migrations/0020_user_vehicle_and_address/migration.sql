-- Migration: Saved vehicles and the driver's address
-- Created at: 2026-09-19
--
-- Bookings take a number plate as free text today, so a driver retypes it at
-- every checkout. Saving vehicles removes that, lets the right ParkingCapacity
-- be picked from the vehicle's type, and gives the gate a plate to verify.
--
-- UserAddress is the person's own address. It is deliberately not HostProfile,
-- whose address is where a parking spot is rather than where its owner lives;
-- a user can have both, and they are rarely the same place.

CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vehicleNumber" TEXT NOT NULL,
    "vehicleType" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- Numbers are stored normalised (uppercase, no separators), so this really
-- does stop the same plate being added twice as "MH01AB1234" and "MH 01 AB 1234".
CREATE UNIQUE INDEX "Vehicle_userId_vehicleNumber_key" ON "Vehicle"("userId", "vehicleNumber");
CREATE INDEX "Vehicle_userId_idx" ON "Vehicle"("userId");

ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "UserAddress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'India',
    "state" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "addressLine" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAddress_pkey" PRIMARY KEY ("id")
);

-- One address per user, enforced by the database rather than by the service.
CREATE UNIQUE INDEX "UserAddress_userId_key" ON "UserAddress"("userId");

ALTER TABLE "UserAddress" ADD CONSTRAINT "UserAddress_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
