-- Migration: Create all remaining core tables with audit fields
-- Created at: 2026-09-13

-- Listing table (with createdBy/updatedBy)
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "listingType" "ListingType" NOT NULL DEFAULT 'EVENT',
    "name" TEXT NOT NULL,
    "venueName" TEXT NOT NULL,
    "latitude" DECIMAL(65, 30),
    "longitude" DECIMAL(65, 30),
    "eventDate" TIMESTAMP(3),
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Listing_organizerId_idx" ON "Listing"("organizerId");
CREATE INDEX "Listing_createdBy_idx" ON "Listing"("createdBy");
CREATE INDEX "Listing_updatedBy_idx" ON "Listing"("updatedBy");

ALTER TABLE "Listing" ADD CONSTRAINT "Listing_organizerId_fkey"
    FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Listing" ADD CONSTRAINT "Listing_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Listing" ADD CONSTRAINT "Listing_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ParkingCapacity table
CREATE TABLE "ParkingCapacity" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "vehicleType" "VehicleType" NOT NULL,
    "totalCapacity" INTEGER NOT NULL,
    "bookedCount" INTEGER NOT NULL DEFAULT 0,
    "price" DECIMAL(65, 30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParkingCapacity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ParkingCapacity_listingId_vehicleType_key" ON "ParkingCapacity"("listingId", "vehicleType");

ALTER TABLE "ParkingCapacity" ADD CONSTRAINT "ParkingCapacity_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Booking table (with createdBy/updatedBy)
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "parkingCapacityId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "vehicleNumber" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount" DECIMAL(65, 30) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "qrToken" TEXT NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Booking_idempotencyKey_key" ON "Booking"("idempotencyKey");
CREATE UNIQUE INDEX "Booking_qrToken_key" ON "Booking"("qrToken");
CREATE INDEX "Booking_parkingCapacityId_idx" ON "Booking"("parkingCapacityId");
CREATE INDEX "Booking_driverId_idx" ON "Booking"("driverId");
CREATE INDEX "Booking_createdBy_idx" ON "Booking"("createdBy");
CREATE INDEX "Booking_updatedBy_idx" ON "Booking"("updatedBy");

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_parkingCapacityId_fkey"
    FOREIGN KEY ("parkingCapacityId") REFERENCES "ParkingCapacity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_driverId_fkey"
    FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Payment table (with createdBy/updatedBy)
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "amount" DECIMAL(65, 30) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Payment_bookingId_key" ON "Payment"("bookingId");
CREATE INDEX "Payment_createdBy_idx" ON "Payment"("createdBy");
CREATE INDEX "Payment_updatedBy_idx" ON "Payment"("updatedBy");

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Settlement table (with createdBy/updatedBy)
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "grossAmount" DECIMAL(65, 30) NOT NULL,
    "commissionAmount" DECIMAL(65, 30) NOT NULL,
    "netPayable" DECIMAL(65, 30) NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Settlement_organizerId_idx" ON "Settlement"("organizerId");
CREATE INDEX "Settlement_createdBy_idx" ON "Settlement"("createdBy");
CREATE INDEX "Settlement_updatedBy_idx" ON "Settlement"("updatedBy");

ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_organizerId_fkey"
    FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SettlementItem table
CREATE TABLE "SettlementItem" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "amount" DECIMAL(65, 30) NOT NULL,
    "commissionDeducted" DECIMAL(65, 30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SettlementItem_settlementId_idx" ON "SettlementItem"("settlementId");
CREATE INDEX "SettlementItem_bookingId_idx" ON "SettlementItem"("bookingId");

ALTER TABLE "SettlementItem" ADD CONSTRAINT "SettlementItem_settlementId_fkey"
    FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SettlementItem" ADD CONSTRAINT "SettlementItem_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
