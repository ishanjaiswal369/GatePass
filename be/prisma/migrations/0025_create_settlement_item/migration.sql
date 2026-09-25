-- Migration: Create the SettlementItem table -- what one settlement pays for

CREATE TABLE "SettlementItem" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "bookingId" TEXT,
    "monthlyReservationId" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "commissionDeducted" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SettlementItem_settlementId_idx" ON "SettlementItem"("settlementId");
CREATE INDEX "SettlementItem_bookingId_idx" ON "SettlementItem"("bookingId");
CREATE INDEX "SettlementItem_monthlyReservationId_idx" ON "SettlementItem"("monthlyReservationId");

ALTER TABLE "SettlementItem" ADD CONSTRAINT "SettlementItem_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementItem" ADD CONSTRAINT "SettlementItem_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementItem" ADD CONSTRAINT "SettlementItem_monthlyReservationId_fkey" FOREIGN KEY ("monthlyReservationId") REFERENCES "MonthlyReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
