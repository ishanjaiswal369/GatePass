-- Migration: Split User.name into firstName/lastName, carry pending signup
--            names on EmailVerification
-- Created at: 2026-09-18
--
-- Signup collects the name up front, but the User row is only created after
-- the emailed code is verified. The pending name therefore lives on the
-- EmailVerification row until then, so an unverified email never creates a
-- user. Both columns are nullable: a code requested from the sign-in screen
-- carries no name, and that user completes their profile afterwards via
-- PATCH /auth/me.

-- User: name -> firstName + lastName
ALTER TABLE "User" ADD COLUMN "firstName" TEXT;
ALTER TABLE "User" ADD COLUMN "lastName" TEXT;

-- Carry any existing single-field names over. Everything before the first
-- space becomes firstName, the remainder becomes lastName; a single-word
-- name leaves lastName null, which is intended (mononyms stay valid).
UPDATE "User"
SET "firstName" = split_part("name", ' ', 1),
    "lastName"  = NULLIF(substring("name" FROM position(' ' IN "name") + 1), "name")
WHERE "name" IS NOT NULL AND "name" <> '';

ALTER TABLE "User" DROP COLUMN "name";

-- EmailVerification: pending signup name
ALTER TABLE "EmailVerification" ADD COLUMN "firstName" TEXT;
ALTER TABLE "EmailVerification" ADD COLUMN "lastName" TEXT;
