-- Migration: Create the ProblemReport table -- a driver's report about a spot

CREATE TABLE "ProblemReport" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "details" TEXT,
    "photoUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "refunded" BOOLEAN,
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProblemReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProblemReport_bookingId_key" ON "ProblemReport"("bookingId");
CREATE INDEX "ProblemReport_status_createdAt_idx" ON "ProblemReport"("status", "createdAt");
CREATE INDEX "ProblemReport_driverId_idx" ON "ProblemReport"("driverId");
CREATE INDEX "ProblemReport_listingId_idx" ON "ProblemReport"("listingId");
CREATE INDEX "ProblemReport_resolvedBy_idx" ON "ProblemReport"("resolvedBy");

ALTER TABLE "ProblemReport" ADD CONSTRAINT "ProblemReport_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProblemReport" ADD CONSTRAINT "ProblemReport_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProblemReport" ADD CONSTRAINT "ProblemReport_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProblemReport" ADD CONSTRAINT "ProblemReport_resolvedBy_fkey" FOREIGN KEY ("resolvedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
