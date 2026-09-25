# GatePass

Monorepo with Expo (React Native) frontend and Fastify + Prisma (PostgreSQL) backend.

## Structure

```
fe/   — Expo React Native app
be/   — Fastify API with Prisma ORM + PostgreSQL
```

## Setup

### Prerequisites
- Node.js 18+ (22 used in development)
- Docker, for PostgreSQL (`docker-compose.yml`, service `db`)

### Install dependencies
```bash
npm ci          # at the repo root: npm workspaces install fe/ and be/ together
```

### Backend
```bash
docker compose up -d db
cd be
cp .env.example .env
# set JWT_SECRET (e.g. `openssl rand -hex 32`); for local work keep
# EMAIL_PROVIDER=console, SHOW_OTP_IN_RESPONSE=true, STORAGE_PROVIDER=local
npx prisma migrate deploy --schema prisma/schema   # builds every table, one migration per table
npm run seed:spots                                   # optional: seven live spots to search
npm run dev                                          # API on :3000
```

- **Migrations are one `CREATE` per table** (`be/prisma/migrations/0001_create_user`
  … `0025_create_settlement_item`), in foreign-key order. The raw SQL Prisma
  can't model (`btree_gist`, the `CHECK`s and the two `EXCLUDE` overlap
  guards) lives in its table's migration.
- **A database built from the old migrations (0001_enums … 0026) must be
  reset.** `migrate deploy` on it stops with `relation "User" already exists`.
  In `be/`: `npx prisma migrate reset --schema prisma/schema --force`, then
  `npm run seed:spots`. With Docker's `be` service: `docker compose down -v`
  (drops the dev volume), then `docker compose up`.
- **Changing the schema (dev only):** edit the `.prisma` file, apply it with
  `npm run db:push`, and update that table's `create_*` migration to match
  (or add the next `00NN_create_*` for a new table), so a fresh database still
  builds from migrations alone. Check with
  `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema --shadow-database-url <empty db> --exit-code`.
  Editing a migration in place only works while every database can be reset:
  before the first production deploy, switch to additive migrations.
- **Don't run `prisma migrate dev`** on a database you want to keep: if the
  history and the database disagree it offers to reset.

### Frontend
```bash
cd fe
npm run web     # in the browser, against http://localhost:3000
```

On a phone: a development build (`npx expo run:android` / `npx expo run:ios`),
not the store Expo Go app, which runs only the latest Expo SDK. The API and
upload URLs must be reachable from the phone -- see `fe/README.md`, "Running on
a real phone", which also covers what the stores need before publishing.

## API

96 routes in `be/src/api.ts` (routes → requests → controllers →
services). The flows and their API are specified in
`specs/driver-journey_design.md` and `specs/host-onboarding_design.md`.

## Eloquent?

Eloquent is Laravel's PHP ORM — it cannot be used with Node.js. This project uses **Prisma**, which is the Node equivalent: type-safe queries, migrations, and great DX.
