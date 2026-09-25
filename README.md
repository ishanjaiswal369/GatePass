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
npx prisma migrate deploy --schema prisma/schema   # the committed migrations (incl. the raw-SQL constraints)
npm run db:push                                      # everything added since, from the .prisma files
npm run seed:spots                                   # optional: seven live spots to search
npm run dev                                          # API on :3000
```

- **Don't run `prisma migrate dev`.** The schema moves forward with
  `db push` (no new migration files), so `migrate dev` sees drift and offers
  to reset the database. Preview a change with
  `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema --script`.
- **`db push` asks once for `--accept-data-loss`** on a fresh or older
  database: it adds unique indexes on `Payment`/`Refund.monthlyReservationId`
  and always warns about unique indexes. On new, all-NULL columns nothing is
  lost: `npm run db:push -- --accept-data-loss`.
- The raw-SQL constraints `Booking_no_overlap` and `Booking_one_target` come
  from the migrations; `db push` leaves them alone.

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
