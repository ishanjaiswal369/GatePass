-- Migration: Create the Refund table -- money back, for a booking or a monthly term

CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT,
    "monthlyReservationId" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REFUND_PENDING',
    "policy" TEXT NOT NULL,
    "reference" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Refund_bookingId_key" ON "Refund"("bookingId");
CREATE UNIQUE INDEX "Refund_monthlyReservationId_key" ON "Refund"("monthlyReservationId");
CREATE INDEX "Refund_status_idx" ON "Refund"("status");

ALTER TABLE "Refund" ADD CONSTRAINT "Refund_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_monthlyReservationId_fkey" FOREIGN KEY ("monthlyReservationId") REFERENCES "MonthlyReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
