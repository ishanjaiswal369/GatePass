# GatePass

A marketplace for private parking in India. A host lists a space they
control — a driveway, a garage, a bay in a housing society — and drivers book
it by the hour or the day and pay in advance.

One Expo (React Native) app for drivers and hosts, and a Fastify + Prisma
(PostgreSQL) API. Payments, refunds and host payouts go through Cashfree.

> **Status:** in development. Payments run against the Cashfree sandbox; the
> app runs in a browser and as an Android development build. What is built,
> checked against the code, is in [`IMPLEMENTATION.md`](IMPLEMENTATION.md).

## What it does

**For drivers**
- Search by place and time, see only spaces that are free for the whole stay,
  with the price for their vehicle.
- Book and pay by UPI. The space is held for 15 minutes while they pay; the
  listed price is the price, with no booking fee.
- A confirmed booking shows the address, directions and the host's access
  instructions. Extra time can be bought while parked.
- Cancel free until an hour before the start (50% of the parking after that),
  or report a problem if the space can't be used. Refunds go back to the
  method they paid with.

**For hosts**
- A nine-step listing wizard: the space, its address and pin, photos, what
  fits, opening hours, prices by the hour and/or day, how to get in, and
  proof of ownership or permission.
- A listing goes live once the document is approved and the payout account
  is verified.
- A dashboard per space: today's bookings, pause new bookings, block hours,
  earnings. The host's share of each booking is paid to their bank by the
  payment gateway.

## Stack

| | |
|---|---|
| App | Expo SDK 51, React Native 0.74, expo-router, TypeScript |
| API | Node.js, Fastify 4, TypeScript (ESM), zod at the request boundary |
| Data | PostgreSQL 16, Prisma 5 (multi-file schema, hand-written migrations) |
| Auth | Email code or Google, both issuing JWT sessions; optional password |
| Payments | Cashfree PG + Easy Split (orders, UPI, webhooks, refunds, host settlements) |
| Push | Firebase Cloud Messaging |

## Repository

```
fe/      the app: routes in app/, everything else in src/        (fe/README.md)
be/      the API: api.ts → requests/ → controllers/ → services/
specs/   technical designs, one per feature
docs/    the public policy pages (built from fe/src/features/legal/content.json)
design/  canvas source for the sign-in screens, and the splash
```

## Getting started

Needs Node.js 18+ (22 is used in development) and Docker for PostgreSQL.

```bash
npm ci                         # at the repo root: installs fe/ and be/ together
```

### API

```bash
docker compose up -d db
cd be
cp .env.example .env
# Set JWT_SECRET (`openssl rand -hex 32`). For local work keep
# EMAIL_PROVIDER=console, SHOW_OTP_IN_RESPONSE=true, STORAGE_PROVIDER=local.
npx prisma migrate deploy --schema prisma/schema   # builds every table
npm run seed:spots                                   # optional: live spots to search
npm run dev                                          # API on :3000
```

`docker compose up -d --build` runs the API in a container instead. It serves
the image it was built from, so rebuild it after changing `be/`;
`GET /health` reports the build time and the route count.

With `EMAIL_PROVIDER=console` and `SHOW_OTP_IN_RESPONSE=true` the login code
is shown on the code screen, so no mail has to be sent to sign in.

### App

```bash
cd fe
npm run web                    # in a browser, against http://localhost:3000
```

On an Android phone over USB, with the development build installed
(`npm run android` builds and installs it; the store's Expo Go app won't run
this project):

```bash
adb reverse tcp:3000 tcp:3000  # the API and uploads
adb reverse tcp:8081 tcp:8081  # Metro
npx expo start --dev-client --localhost
```

More on devices, and what the stores need before publishing, in
[`fe/README.md`](fe/README.md).

### Payments (Cashfree sandbox)

In `be/.env`: `PAYMENT_PROVIDER=cashfree`, `CASHFREE_ENV=sandbox`,
`CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET`. For webhooks, Cashfree has to
reach the API:

```bash
npm run tunnel -w be           # prints a https://….trycloudflare.com address
```

Put that address in `WEBHOOK_PUBLIC_URL`, restart the API, and set
`<address>/webhooks/cashfree` as the webhook endpoint in the Cashfree
dashboard. The address changes every time the tunnel starts. Without it,
payments and refunds are still confirmed by asking Cashfree when the booking
is read.

## Checks

```bash
npm run typecheck              # both workspaces, from the repo root
```

In `be/`:

```bash
npm run test:cashfree          # the Cashfree client and booking → order → payment, on a fake gateway
npm run test:refunds           # cancel → refund → webhook / status → retry, on a fake gateway
npm run test:api               # search, quotes, booking, overlap, cancel, review, extend, host endpoints
npm run test:migrations        # needs SHADOW_DATABASE_URL: the migrations build exactly the schema
npm run test:fixture           # a driver and a host with a stay in every state, to click through
```

- The two Cashfree suites run in-process against a fake gateway on localhost
  and need no keys.
- `test:api` runs against the API from source (`npm run dev`) with
  `PAYMENT_PROVIDER=none`, `EMAIL_PROVIDER=console` and
  `SHOW_OTP_IN_RESPONSE=true`. It signs up its own users and spot, sets paid
  states directly in the database, and deletes what it made.

## Working on the database

- **Migrations are one `CREATE` per table** (`be/prisma/migrations/`), in
  foreign-key order. The raw SQL Prisma can't model (`btree_gist`, the
  `CHECK`s and the two `EXCLUDE` overlap guards) lives in its table's
  migration.
- **Changing the schema (development only):** edit the `.prisma` file, apply
  it with `npm run db:push`, and update that table's `create_*` migration to
  match, so a fresh database still builds from migrations alone. Before the
  first production deploy this switches to additive migrations.
- **A database built from an earlier set of migrations must be reset:**
  `npx prisma migrate reset --schema prisma/schema --force` in `be/`, or
  `docker compose down -v` to drop the dev volume.
- **Don't run `prisma migrate dev`** on a database you want to keep: if the
  history and the database disagree it offers to reset.

## Documentation

| | |
|---|---|
| [`IMPLEMENTATION.md`](IMPLEMENTATION.md) | What is built and how, section by section; what is not built yet |
| [`fe/README.md`](fe/README.md) | App structure, conventions, running on a device |
| [`specs/`](specs/) | Designs: driver and host journey, host onboarding, host payouts, Cashfree payments, refunds, paid extra time, the 2026-10 code review |
| [`docs/`](docs/) | Terms, privacy, refund and shipping policies, as published |
