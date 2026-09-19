-- Migration: What a verification code is allowed to do
-- Created at: 2026-09-19
--
-- verifyCode picks the newest unverified row for an address and trusts it.
-- Once password reset also mails a code to the same address, that is a hole in
-- both directions: a reset code would sign the holder in, and a login code
-- would let them set a password. A code has to name its own purpose, and both
-- flows have to filter on it.
--
-- Existing rows are all login codes, which is what the default records.

ALTER TABLE "EmailVerification" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'LOGIN';

-- Rate limiting counts recent rows per address; it now counts them per purpose
-- as well, so asking for a password reset cannot exhaust the login allowance.
DROP INDEX IF EXISTS "EmailVerification_email_createdAt_idx";
CREATE INDEX "EmailVerification_email_purpose_createdAt_idx"
    ON "EmailVerification"("email", "purpose", "createdAt");
