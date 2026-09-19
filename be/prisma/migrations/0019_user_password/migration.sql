-- Migration: Optional password on a user
-- Created at: 2026-09-19
--
-- The product started passwordless and stays that way: email codes and Google
-- sign-in are unchanged. A password is an additional way in, set from the
-- profile screen or through forgot-password, so the column is nullable and
-- most rows will keep it null.
--
-- The hash is scrypt (Node's built-in crypto), stored as
-- "scrypt$N$r$p$salt$hash". No dependency to add, no native module to build in
-- the Alpine image, and the work factor is recorded in the value itself so it
-- can be raised later without invalidating existing hashes.

ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "User" ADD COLUMN "passwordSetAt" TIMESTAMP(3);
