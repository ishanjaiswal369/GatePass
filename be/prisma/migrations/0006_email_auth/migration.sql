-- Migration: Switch the login identifier from phone to email
-- Created at: 2026-09-17

-- User: email becomes the login identifier; phone becomes an optional profile field
ALTER TABLE "User" ADD COLUMN "email" TEXT;

-- Dev-stage cleanup: users created while login was phone-based have no email, and there is
-- no meaningful value to backfill. Remove them so the NOT NULL below can be applied.
DELETE FROM "User" WHERE "email" IS NULL;

ALTER TABLE "User" ALTER COLUMN "email" SET NOT NULL;
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

ALTER TABLE "User" ALTER COLUMN "phone" DROP NOT NULL;

-- OtpVerification -> EmailVerification (rename in place, no data loss)
ALTER TABLE "OtpVerification" RENAME TO "EmailVerification";
ALTER TABLE "EmailVerification" RENAME COLUMN "phone" TO "email";
ALTER INDEX "OtpVerification_phone_idx" RENAME TO "EmailVerification_email_idx";
ALTER TABLE "EmailVerification" RENAME CONSTRAINT "OtpVerification_pkey" TO "EmailVerification_pkey";
