-- Migration: A settlement is paid to an organizer or to a host
-- Created at: 2026-09-19
--
-- Hosts are paid through the same periodic settlement engine as organizers in
-- v1. Instant payout (Razorpay Route) is a deliberate omission: it needs a
-- per-host linked account and KYC that self-serve onboarding does not collect
-- yet. Recording the trade-off here because the shape of this table is what
-- makes it reversible later.
--
-- The payee columns are both nullable with a CHECK, rather than one nullable
-- "payeeType"/"payeeId" pair, so the foreign keys still do their job.

ALTER TABLE "Settlement" DROP CONSTRAINT "Settlement_organizerId_fkey";

UPDATE "Settlement" s
SET "organizerId" = m."organizerId"
FROM "OrganizerMember" m
WHERE s."organizerId" = m."userId";

ALTER TABLE "Settlement" ALTER COLUMN "organizerId" DROP NOT NULL;

ALTER TABLE "Settlement" ADD COLUMN "hostProfileId" TEXT;

ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_organizerId_fkey"
    FOREIGN KEY ("organizerId") REFERENCES "Organizer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_hostProfileId_fkey"
    FOREIGN KEY ("hostProfileId") REFERENCES "HostProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Settlement_hostProfileId_idx" ON "Settlement"("hostProfileId");

-- Money must have exactly one destination. Without this, a settlement with
-- both payees set or neither set is a silent payout bug.
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_one_payee"
    CHECK (
        ("organizerId" IS NOT NULL AND "hostProfileId" IS NULL)
        OR ("organizerId" IS NULL AND "hostProfileId" IS NOT NULL)
    );
