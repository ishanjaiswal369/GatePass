-- Migration: Create the OrganizerMember table -- staff who act for an organizer

CREATE TABLE "OrganizerMember" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memberRole" TEXT NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizerMember_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrganizerMember_userId_idx" ON "OrganizerMember"("userId");
CREATE UNIQUE INDEX "OrganizerMember_organizerId_userId_key" ON "OrganizerMember"("organizerId", "userId");

ALTER TABLE "OrganizerMember" ADD CONSTRAINT "OrganizerMember_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "Organizer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizerMember" ADD CONSTRAINT "OrganizerMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
