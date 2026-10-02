-- Migration: Create the Refund table -- money back to a driver, and its state at the gateway

CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REFUND_PENDING',
    "policy" TEXT NOT NULL,
    "reference" TEXT,
    "processedAt" TIMESTAMP(3),
    "gatewayRefundId" TEXT,
    "gatewayRefundRef" TEXT,
    "splitAmount" DECIMAL(65,30),
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "sendTries" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Refund_bookingId_key" ON "Refund"("bookingId");
CREATE UNIQUE INDEX "Refund_gatewayRefundId_key" ON "Refund"("gatewayRefundId");
CREATE INDEX "Refund_status_idx" ON "Refund"("status");

ALTER TABLE "Refund" ADD CONSTRAINT "Refund_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
