-- Migration: Create the ListingBlock table -- times a host has taken off sale

CREATE TABLE "ListingBlock" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingBlock_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ListingBlock_listingId_startsAt_idx" ON "ListingBlock"("listingId", "startsAt");
CREATE INDEX "ListingBlock_createdBy_idx" ON "ListingBlock"("createdBy");

ALTER TABLE "ListingBlock" ADD CONSTRAINT "ListingBlock_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListingBlock" ADD CONSTRAINT "ListingBlock_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
