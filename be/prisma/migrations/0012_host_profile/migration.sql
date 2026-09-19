-- Migration: Host profiles
-- Created at: 2026-09-19
--
-- A host is a user who rents out their own parking space. This is a separate
-- table rather than a "role" value on User on purpose: one person can be a
-- driver and a host at the same time, and a single role column cannot hold
-- both. Every "is this user a host" check reads this table -- never the JWT,
-- which would go stale the moment a user onboards.
--
-- verificationStatus defaults to ACTIVE because onboarding is self-serve for
-- now. The column exists so that turning on real verification later is a data
-- change instead of a schema change.

CREATE TABLE "HostProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addressLine" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "latitude" DECIMAL(65, 30) NOT NULL,
    "longitude" DECIMAL(65, 30) NOT NULL,
    "panNumber" TEXT,
    "bankAccountId" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HostProfile_pkey" PRIMARY KEY ("id")
);

-- Unique, so the 1:1 with User is enforced by the database and not by hope.
CREATE UNIQUE INDEX "HostProfile_userId_key" ON "HostProfile"("userId");

-- Bounding-box prefilter for the Nearby search.
CREATE INDEX "HostProfile_latitude_longitude_idx" ON "HostProfile"("latitude", "longitude");

ALTER TABLE "HostProfile" ADD CONSTRAINT "HostProfile_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
