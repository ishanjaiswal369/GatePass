-- Migration: Listings belong to an Organizer, not to a user row
-- Created at: 2026-09-19
--
-- Listing.organizerId used to point at User. That made "organizer" a person,
-- which breaks the moment a business needs a second login -- and it makes the
-- new OrganizerMember table useless, because the ids it hands to the access
-- check would not match the ids on the listings it is meant to gate.
--
-- Every user who owns a listing or a settlement today gets one Organizer and
-- one OWNER membership, and the foreign key is repointed at it. Settlement is
-- repointed in the next migration, which reads the mapping back out of
-- OrganizerMember.
--
-- The new organizer id is derived from the owner's user id with md5 rather
-- than gen_random_uuid(), so the three statements below agree on it without a
-- temp table and without joining on a display name -- two users called "Ravi
-- Kumar" would have cross-joined and handed each other's listings over.

CREATE TEMP VIEW "_organizer_owners" AS
SELECT
    u."id" AS "userId",
    md5('organizer:' || u."id")::uuid::text AS "organizerId",
    -- The organizer's display name has to come from somewhere; the owner's
    -- name is the best guess available and is editable afterwards.
    COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u."firstName", u."lastName")), ''), u."email") AS "name",
    u."gstNumber" AS "gstNumber",
    u."bankAccountId" AS "bankAccountId"
FROM "User" u
WHERE u."id" IN (
    SELECT "organizerId" FROM "Listing" WHERE "organizerId" IS NOT NULL
    UNION
    SELECT "organizerId" FROM "Settlement"
);

INSERT INTO "Organizer" ("id", "name", "gstNumber", "bankAccountId", "createdAt", "updatedAt")
SELECT o."organizerId", o."name", o."gstNumber", o."bankAccountId", NOW(), NOW()
FROM "_organizer_owners" o;

INSERT INTO "OrganizerMember" ("id", "organizerId", "userId", "memberRole", "createdAt")
SELECT gen_random_uuid()::text, o."organizerId", o."userId", 'OWNER', NOW()
FROM "_organizer_owners" o;

ALTER TABLE "Listing" DROP CONSTRAINT "Listing_organizerId_fkey";

UPDATE "Listing" l
SET "organizerId" = o."organizerId"
FROM "_organizer_owners" o
WHERE l."organizerId" = o."userId";

ALTER TABLE "Listing" ADD CONSTRAINT "Listing_organizerId_fkey"
    FOREIGN KEY ("organizerId") REFERENCES "Organizer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP VIEW "_organizer_owners";
