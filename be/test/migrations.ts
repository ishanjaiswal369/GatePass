/**
 * Checks that the migrations build exactly the schema: a fresh database made
 * from prisma/migrations and one made from prisma/schema must not differ.
 *
 *   SHADOW_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/gatepass_shadow npm run test:migrations
 *
 * The shadow database must exist and hold nothing you want: Prisma wipes it
 * to replay the migrations into. Exits 0 when they match, 2 when they differ
 * (and prints the SQL that would close the gap).
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const shadow = process.env.SHADOW_DATABASE_URL;
if (!shadow) {
  console.error("Set SHADOW_DATABASE_URL to an empty database Prisma may wipe, e.g. .../gatepass_shadow");
  process.exit(1);
}

// The CLI run by node directly rather than through npx and a shell, so the
// URL's ? and & reach Prisma as they are on every platform.
const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");

const result = spawnSync(
  process.execPath,
  [
    prismaCli,
    "migrate",
    "diff",
    "--from-migrations",
    "prisma/migrations",
    "--to-schema-datamodel",
    "prisma/schema",
    "--shadow-database-url",
    shadow,
    "--script",
    "--exit-code",
  ],
  { stdio: "inherit" }
);

if (result.status === 0) console.log("Migrations match the schema.");
process.exit(result.status ?? 1);
