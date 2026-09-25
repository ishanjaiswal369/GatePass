-- Migration: Create the Settlement table -- a payout to an organizer or a host

CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT,
    "hostProfileId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "grossAmount" DECIMAL(65,30) NOT NULL,
    "commissionAmount" DECIMAL(65,30) NOT NULL,
    "netPayable" DECIMAL(65,30) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Settlement_organizerId_idx" ON "Settlement"("organizerId");
CREATE INDEX "Settlement_hostProfileId_idx" ON "Settlement"("hostProfileId");
CREATE INDEX "Settlement_createdBy_idx" ON "Settlement"("createdBy");
CREATE INDEX "Settlement_updatedBy_idx" ON "Settlement"("updatedBy");

ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "Organizer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_hostProfileId_fkey" FOREIGN KEY ("hostProfileId") REFERENCES "HostProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Money must have exactly one destination. Without this, a settlement with
-- both payees set or neither set is a silent payout bug. Two nullable columns
-- with a CHECK, rather than a "payeeType"/"payeeId" pair, so the foreign keys
-- still do their job.
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_one_payee"
    CHECK (
        ("organizerId" IS NOT NULL AND "hostProfileId" IS NULL)
        OR ("organizerId" IS NULL AND "hostProfileId" IS NOT NULL)
    );
