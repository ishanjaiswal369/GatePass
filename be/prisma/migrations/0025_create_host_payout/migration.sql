-- Migration: Create the HostPayout table -- the gateway's transfers of a host's money to their bank

CREATE TABLE "HostPayout" (
    "id" TEXT NOT NULL,
    "hostProfileId" TEXT NOT NULL,
    "gatewaySettlementId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "utr" TEXT,
    "reason" TEXT,
    "periodFrom" TIMESTAMP(3),
    "periodTill" TIMESTAMP(3),
    "initiatedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HostPayout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HostPayout_gatewaySettlementId_key" ON "HostPayout"("gatewaySettlementId");
CREATE INDEX "HostPayout_hostProfileId_createdAt_idx" ON "HostPayout"("hostProfileId", "createdAt");

ALTER TABLE "HostPayout" ADD CONSTRAINT "HostPayout_hostProfileId_fkey" FOREIGN KEY ("hostProfileId") REFERENCES "HostProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
