-- Migration: Create the MonthlyReservation table -- a prepaid monthly term on a host spot

CREATE TABLE "MonthlyReservation" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "vehicleNumber" TEXT NOT NULL,
    "vehicleType" TEXT NOT NULL,
    "days" INTEGER[],
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "startDate" TEXT NOT NULL,
    "months" INTEGER NOT NULL,
    "endDate" TEXT NOT NULL,
    "pricePerMonth" DECIMAL(65,30) NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "platformFee" DECIMAL(65,30) NOT NULL,
    "taxAmount" DECIMAL(65,30) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "holdExpiresAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MonthlyReservation_idempotencyKey_key" ON "MonthlyReservation"("idempotencyKey");
CREATE INDEX "MonthlyReservation_listingId_status_idx" ON "MonthlyReservation"("listingId", "status");
CREATE INDEX "MonthlyReservation_driverId_status_idx" ON "MonthlyReservation"("driverId", "status");

ALTER TABLE "MonthlyReservation" ADD CONSTRAINT "MonthlyReservation_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MonthlyReservation" ADD CONSTRAINT "MonthlyReservation_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
