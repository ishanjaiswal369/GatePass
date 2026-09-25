-- Migration: Create the ParkingCapacity table -- an event lot's slots per vehicle type

CREATE TABLE "ParkingCapacity" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "vehicleType" TEXT NOT NULL,
    "gate" TEXT,
    "totalCapacity" INTEGER NOT NULL,
    "bookedCount" INTEGER NOT NULL DEFAULT 0,
    "price" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParkingCapacity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ParkingCapacity_listingId_vehicleType_key" ON "ParkingCapacity"("listingId", "vehicleType");

ALTER TABLE "ParkingCapacity" ADD CONSTRAINT "ParkingCapacity_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
