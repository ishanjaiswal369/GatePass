-- Migration: Create the Listing table -- a host's bookable space

CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "hostProfileId" TEXT,
    "listingType" TEXT NOT NULL DEFAULT 'INDEPENDENT_SPOT',
    "name" TEXT NOT NULL,
    "venueName" TEXT NOT NULL,
    "latitude" DECIMAL(65,30),
    "longitude" DECIMAL(65,30),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "spaceType" TEXT,
    "description" TEXT,
    "addressLine" TEXT,
    "societyName" TEXT,
    "area" TEXT,
    "building" TEXT,
    "street" TEXT,
    "pinConfirmedAt" TIMESTAMP(3),
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "googlePlaceId" TEXT,
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "amenityNote" TEXT,
    "vehicleTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxVehicleHeightCm" INTEGER,
    "maxVehicleSize" TEXT,
    "bayWidthCm" INTEGER,
    "bayLengthCm" INTEGER,
    "minStayMinutes" INTEGER,
    "maxStayMinutes" INTEGER,
    "advanceDays" INTEGER,
    "entryPoint" TEXT,
    "entryMethod" TEXT,
    "bayNumber" TEXT,
    "parkingMarker" TEXT,
    "rules" TEXT,
    "bookingsPausedAt" TIMESTAMP(3),
    "accessInstructions" TEXT,
    "ownershipDocUrl" TEXT,
    "ownershipDocType" TEXT,
    "permissionBasis" TEXT,
    "inSociety" BOOLEAN,
    "societyPermissionAt" TIMESTAMP(3),
    "warrantyAcceptedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "docApprovedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "rejectionReason" TEXT,
    "rejectionSection" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Listing_hostProfileId_idx" ON "Listing"("hostProfileId");
CREATE INDEX "Listing_listingType_status_idx" ON "Listing"("listingType", "status");
CREATE INDEX "Listing_status_submittedAt_idx" ON "Listing"("status", "submittedAt");
CREATE INDEX "Listing_latitude_longitude_idx" ON "Listing"("latitude", "longitude");
CREATE INDEX "Listing_createdBy_idx" ON "Listing"("createdBy");
CREATE INDEX "Listing_updatedBy_idx" ON "Listing"("updatedBy");

ALTER TABLE "Listing" ADD CONSTRAINT "Listing_hostProfileId_fkey" FOREIGN KEY ("hostProfileId") REFERENCES "HostProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Every listing belongs to a host, so a row can never end up orphaned.
-- (Organizer-owned event listings were removed on 2026-09-27.)
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_has_host"
    CHECK ("hostProfileId" IS NOT NULL);
