-- Migration: Create the SpotPricing table -- a host spot's rates per vehicle type

CREATE TABLE "SpotPricing" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "vehicleType" TEXT NOT NULL,
    "pricePerHour" DECIMAL(65,30),
    "pricePerDay" DECIMAL(65,30),
    "pricePerMonth" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpotPricing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SpotPricing_listingId_vehicleType_key" ON "SpotPricing"("listingId", "vehicleType");

ALTER TABLE "SpotPricing" ADD CONSTRAINT "SpotPricing_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
