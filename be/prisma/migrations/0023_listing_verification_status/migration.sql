-- Migration: Per-spot moderation status
-- Created at: 2026-09-21
--
-- Listing.status is publish lifecycle (DRAFT/PUBLISHED/ONGOING/COMPLETED/
-- CANCELLED); it says nothing about whether a spot has been looked at. Now
-- that a host can list more than one spot, each one needs its own review
-- state rather than sharing HostProfile's single verificationStatus column.
--
-- Defaults to ACTIVE, same reasoning as HostProfile.verificationStatus: spot
-- review is self-serve for now, and there is no reviewer yet to move a
-- PENDING row forward. The column exists so turning review on later is a
-- data change, not a schema change.

ALTER TABLE "Listing" ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'ACTIVE';
