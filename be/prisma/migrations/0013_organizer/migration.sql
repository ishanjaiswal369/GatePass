-- Migration: Organizer as its own entity
-- Created at: 2026-09-19
--
-- An organizer is a business, not a person: it outlives any one login and will
-- need several of them. OrganizerMember is the join table that makes team
-- logins a row insert later instead of a migration under load. Today it holds
-- exactly one OWNER row per organizer.

CREATE TABLE "Organizer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gstNumber" TEXT,
    "bankAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organizer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizerMember" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memberRole" TEXT NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizerMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizerMember_organizerId_userId_key"
    ON "OrganizerMember"("organizerId", "userId");

-- The staff check looks up by user on every organizer request.
CREATE INDEX "OrganizerMember_userId_idx" ON "OrganizerMember"("userId");

ALTER TABLE "OrganizerMember" ADD CONSTRAINT "OrganizerMember_organizerId_fkey"
    FOREIGN KEY ("organizerId") REFERENCES "Organizer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizerMember" ADD CONSTRAINT "OrganizerMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
