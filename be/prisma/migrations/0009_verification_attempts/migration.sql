-- Migration: Track wrong-code attempts per verification row
-- Created at: 2026-09-18
--
-- A 6-digit code with unlimited tries is brute-forceable in well under the
-- 5-minute expiry window. verifyCode now increments this counter on a
-- mismatch and stops selecting the row once it reaches the cap, so a guessing
-- run has to request a fresh code -- which the per-email rate limit then
-- throttles.

ALTER TABLE "EmailVerification" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;

-- Rate limiting counts rows per email inside a time window.
CREATE INDEX "EmailVerification_email_createdAt_idx"
  ON "EmailVerification"("email", "createdAt");
