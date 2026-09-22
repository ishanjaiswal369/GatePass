-- Migration: Keep the payout details a host submits, and drop HostProfile's address
-- Created at: 2026-09-22
--
-- Two changes, both consequences of the same shift: HostProfile has stopped
-- being "the host's one spot" and become "this user is a host".
--
-- 1. Payout details were collected and thrown away. `submit` validated a PAN,
--    an account holder, an account number and an IFSC, then stored only the
--    PAN and parked the host at UNDER_REVIEW -- for a review with nothing to
--    review. Whoever clears that status, an admin today and a gateway later,
--    needs the details that were entered.
--
-- 2. HostProfile's address columns are dead. Migration 0023 moved a spot's
--    address onto the Listing that describes it, because a host with two
--    driveways has two addresses; what was left here was whichever spot saved
--    last. Nothing reads them any more, and they were NOT NULL -- which is
--    what forced a brand-new host to hand over an address before they could
--    have a listing at all, and so forced a nameless draft row to exist first.

-- --------------------------------------------------------------- payout ----

ALTER TABLE "HostProfile" ADD COLUMN "payoutAccountName" TEXT;
ALTER TABLE "HostProfile" ADD COLUMN "payoutAccountNumber" TEXT;
ALTER TABLE "HostProfile" ADD COLUMN "payoutIfsc" TEXT;
ALTER TABLE "HostProfile" ADD COLUMN "payoutSubmittedAt" TIMESTAMP(3);

-- Superseded by payoutAccountId, which is the gateway's own id for the
-- account rather than a number we hold. Never read.
ALTER TABLE "HostProfile" DROP COLUMN "bankAccountId";

-- -------------------------------------------------------------- address ----

-- Dropped rather than made nullable: a nullable copy of a fact that lives on
-- Listing is still a second copy free to disagree with the first. The data is
-- not lost -- 0023 backfilled every one of these onto the host's listing.
ALTER TABLE "HostProfile" DROP COLUMN "addressLine";
ALTER TABLE "HostProfile" DROP COLUMN "city";
ALTER TABLE "HostProfile" DROP COLUMN "state";
ALTER TABLE "HostProfile" DROP COLUMN "pincode";
ALTER TABLE "HostProfile" DROP COLUMN "latitude";
ALTER TABLE "HostProfile" DROP COLUMN "longitude";
