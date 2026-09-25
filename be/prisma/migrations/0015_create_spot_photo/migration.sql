-- Migration: Create the SpotPhoto table -- a host spot's photos

CREATE TABLE "SpotPhoto" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpotPhoto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SpotPhoto_listingId_position_idx" ON "SpotPhoto"("listingId", "position");

ALTER TABLE "SpotPhoto" ADD CONSTRAINT "SpotPhoto_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
