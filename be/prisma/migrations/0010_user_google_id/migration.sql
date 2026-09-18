-- Migration: Link a Google account to a user
-- Created at: 2026-09-18
--
-- Stores Google's `sub` claim, which is stable for the life of the Google
-- account. Sign-in matches on it before falling back to email, so a user who
-- changes their Google address keeps the same row.
--
-- Nullable because email-code users have no Google identity, and unique so one
-- Google account can never be attached to two users.

ALTER TABLE "User" ADD COLUMN "googleId" TEXT;

CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");
