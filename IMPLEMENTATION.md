# GatePass — Implementation Notes

Last updated: 2026-09-18

A paid marketplace for parking at public ticketed events in India. Organizers
list parking capacity at a venue; drivers reserve and pay in advance; the
platform issues a QR pass for gate entry.

This document describes **what is actually built**, verified against the code
and a running database. Where something is scaffolding rather than working
behaviour, it says so — a previous summary document drifted ahead of the code
and became misleading, which is the mistake this file exists to avoid.

---

## 1. Stack

| Layer | Choice | Notes |
|---|---|---|
| Driver app | Expo (React Native), expo-router | Only `/health` and `/users` wired so far |
| Organizer dashboard | — | Not started |
| API | Fastify + TypeScript | ESM, `node --import tsx/esm` in dev |
| ORM | Prisma | Multi-file schema via `prismaSchemaFolder` |
| Database | PostgreSQL 16 | Docker, named volume `pgdata` |
| Validation | zod | At the request boundary, via `lib/request.ts` |
| Email | Resend, with a `console` provider for dev | `integrations/email/` |
| Auth | Email code (OTP) + JWT sessions | See section 3 |
| Payments | Razorpay | **Not integrated yet** — only DB columns exist |

No logger. Fastify is constructed with logging disabled; a real setup comes
before production. Two paths deliberately use `console` because they would
otherwise vanish silently: the dev login code, and startup failure in
`index.ts`.

There is **no SMS/MSG91 integration** any more. Login codes and (eventually)
the QR pass both go out by email.

---

## 2. Layout

```
be/
  prisma/
    schema/           one .prisma file per domain
    migrations/       hand-written SQL, one per concern
  src/
    api.ts            all route registration
    config/env.ts     zod-validated environment
    constants/enums/  fixed-value domains (see section 5)
    controllers/      HTTP shape only
    requests/         zod schemas per endpoint
    services/         business logic and Prisma access
    integrations/     email provider, axios + retry
    middleware/       authenticate
    lib/              app, errors, prisma, request wrapper
fe/                   Expo app
```

Requests flow `route -> request(schema, handler) -> controller -> service`.
The `request()` wrapper in `lib/request.ts` validates `body`/`query`/`params`
and throws `ValidationError` before the controller runs, so controllers never
see unvalidated input.

---

## 3. Auth flow — built and tested

Email is the login identifier. `User.phone` still exists but is an optional
profile field, not a credential.

There is **one** code flow behind both screens. The signup screen sends a
name; the sign-in screen does not. This means signing up with an
already-registered email signs you in instead of erroring, and no endpoint
reveals whether an address has an account.

```
Signup screen  ->  POST /auth/request-code { email, deviceId, deviceType,
                                             firstName, lastName }
Signin screen  ->  POST /auth/request-code { email, deviceId, deviceType }

                   POST /auth/verify-code  { email, code, deviceId,
                                             deviceType, deviceName?,
                                             fcmToken? }
                     -> latest unverified, unexpired row for that email
                     -> code mismatch          => 400 "Invalid code"
                     -> mark row verified
                     -> user exists?  sign in, name untouched
                        user is new?   create with the name from the row
                     -> createSession(), issue JWT
                     -> { token, user, profileComplete }

                   profileComplete === false
                     -> app asks for a name
                     -> PATCH /auth/me { firstName, lastName? }
```

### Why the name sits on the verification row

`request-code` stores `firstName`/`lastName` on the `EmailVerification` row,
not on a `User`. The `User` row is created only once the code is confirmed, so
an unverified email can never produce an account. If the code expires, the
pending name expires with it.

### Rules that are easy to break later

- An existing account's name is **never** overwritten by a resubmitted one.
- `lastName` is optional everywhere. Mononyms are common in India, and a
  required surname would lock those users out of signup.
- `profileComplete` is derived as `firstName !== null`, not stored.
- Email is trimmed and lowercased by zod, so `Ishan@Example.COM` and
  `ishan@example.com` are the same account.

### Sessions

- JWT payload: `{ userId, email, role, sessionId, deviceId, deviceType }`,
  30-day expiry.
- One `UserSession` row per `(userId, deviceId)`, upserted — logging in again
  from the same device reuses its session rather than piling up rows.
- Every authenticated request re-checks that the session row still exists and
  has not expired, then refreshes `lastActiveAt`. So logout and remote logout
  take effect immediately with no token blocklist.
- `request.user` carries the payload, so handlers read the caller directly.

### Verified end to end

Run against a live database on 2026-09-18, all passing: signup with a name
(`profileComplete: true`); sign-in with a new email (`profileComplete: false`,
then `PATCH /auth/me`); email case normalisation; mononym with `lastName`
null; registered email resubmitted with a different name (signs in, name
preserved, same user id); wrong code rejected with 400; per-device session
reuse and the `current` flag on `GET /auth/sessions`.

---

## 4. Data model

| Table | Purpose |
|---|---|
| `User` | `email` unique + required, `phone` optional, `firstName`/`lastName` both nullable, `role`, `gstNumber`, `bankAccountId` |
| `EmailVerification` | 6-digit `code`, 5-minute expiry, `verified`, plus pending `firstName`/`lastName` |
| `UserSession` | per-device session, `deviceId`, `fcmToken` (reserved), `lastActiveAt`, `expiresAt` |
| `Listing` | organizer's event; `listingType` (only `EVENT` in use), `status`, venue, coords |
| `ParkingCapacity` | per `(listing, vehicleType)`: `totalCapacity`, `bookedCount`, `price` |
| `Booking` | `quantity`, `amount` snapshot, `status`, `idempotencyKey` unique, `qrToken` unique |
| `Payment` | separate from `Booking` because payment state and booking state are different machines; Razorpay ids |
| `Settlement` / `SettlementItem` | per-period organizer payout with a per-booking breakdown |

`createdBy`/`updatedBy` columns exist on `Listing`, `Booking`, `Payment` and
`Settlement`. **Only listing creation actually populates them.**

Naming is Prisma's default: PascalCase tables, camelCase columns. Adding
`@@map`/`@map` for DB-level snake_case is still an open idea.

---

## 5. Enums are TEXT, not Postgres enums

Every fixed-value domain lives in `src/constants/enums/`, one file per enum,
re-exported from `index.ts`. The columns are plain `TEXT`.

Adding a value is a one-line edit with no migration:

```ts
export const VEHICLE_TYPES = ["CAR", "BIKE", "OTHER", "EV"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];
```

The tuple feeds both the TS type and `z.enum(...)` at the request boundary, so
they cannot drift.

**The trade-off, stated plainly:** the database no longer rejects an
unrecognised value. `Booking.status`, `Payment.status` and
`Settlement.status` feed the settlement maths, so a bad value there is a money
bug, not a display bug. Writes to those columns must keep going through the
validated request layer — a manual SQL fix or a future service writing
directly can store a status the app will not understand. If that guarantee is
wanted back later, a `CHECK` constraint is easier to change than a Postgres
enum.

---

## 6. Migrations

Hand-written SQL, one per concern, so each change is reviewable in isolation.

| Migration | Adds |
|---|---|
| `0001_enums` | The original Postgres enum types |
| `0002_user` | `User` |
| `0003_device_otp` | `DeviceType` + `OtpVerification` |
| `0004_user_session` | `UserSession` |
| `0005_base_tables` | `Listing`, `ParkingCapacity`, `Booking`, `Payment`, `Settlement`, `SettlementItem` |
| `0006_email_auth` | Phone → email as the identifier; `OtpVerification` → `EmailVerification` |
| `0007_enums_to_text` | All enum columns → `TEXT`; drops all 8 enum types |
| `0008_split_user_name` | `User.name` → `firstName`/`lastName`; pending name on `EmailVerification` |

All 8 are applied and verified on a live database.

`0006` contains `DELETE FROM "User" WHERE "email" IS NULL` — a deliberate
dev-stage cleanup of phone-era users. **That line must never run against
production data.**

To write the next one with full control over the SQL:

```bash
npx prisma migrate dev --create-only --name <name> --schema prisma/schema
```

---

## 7. API surface

| Method | Path | Auth | State |
|---|---|---|---|
| GET | `/health` | — | Working; reports the email provider |
| POST | `/auth/request-code` | — | Working |
| POST | `/auth/verify-code` | — | Working |
| GET | `/auth/me` | JWT | Working; returns `profileComplete` |
| PATCH | `/auth/me` | JWT | Working |
| POST | `/auth/logout` | JWT | Working |
| GET | `/auth/sessions` | JWT | Working |
| DELETE | `/auth/sessions/:sessionId` | JWT | Working |
| GET / POST | `/users` | **none** | CRUD stub |
| GET / POST | `/listings` | JWT | CRUD stub; populates audit columns |
| GET / POST | `/capacities` | **none** | CRUD stub |
| GET / POST | `/bookings` | **none** | CRUD stub — see below |
| GET / POST | `/payments` | **none** | CRUD stub |
| GET / POST | `/settlements`, `/settlement-items` | **none** | CRUD stub |

---

## 8. What is not built yet

Auth is finished. Everything past it is scaffolding — the tables and routes
exist, but the logic that makes them correct does not.

**Booking is the clearest example.** `POST /bookings` is a bare
`prisma.booking.create()`, which means:

- **No oversell prevention.** The atomic conditional update on
  `ParkingCapacity.bookedCount` — the whole point of that counter — is not
  written. Concurrent bookings will oversell a venue.
- **No idempotency handling.** `idempotencyKey` is accepted and has a unique
  index, but a retry hits a raw constraint violation instead of returning the
  original booking.
- **`driverId`, `amount` and `qrToken` are all taken from the request body.**
  All three must be server-derived: the driver from the JWT, the price from
  `ParkingCapacity`, and the QR token generated server-side. As written, a
  caller can book as another user at a price they choose.

Also missing:

- **Auth on most routes.** Only `/listings` and the `/auth/*` session routes
  check a JWT. Bookings, payments and settlements are open.
- **Role checks.** `role` is in the JWT but nothing enforces it, so a driver
  can call organizer endpoints.
- **OTP rate limiting and an attempt cap.** A 6-digit code with unlimited
  tries is brute-forceable, and `request-code` can be called repeatedly for
  one address — which costs money and sender reputation once Resend is live.
- **`EmailVerification` cleanup.** Used and expired rows are never deleted.
- **Razorpay.** No order creation, no webhook, no capture.
- **Settlement calculation.** Commission and payout maths are not written.
- **QR pass generation and delivery.**
- Organizer dashboard, geo-search, push notifications (the `fcmToken` column
  is reserved but unused), recurring/commercial listing types.

`JWT_SECRET` in the local `.env` is still a placeholder string. It passes the
16-character minimum, so validation will not catch it.

---

## 9. Local setup

```bash
docker compose up -d db
```

```bash
cd be && npx prisma migrate deploy --schema prisma/schema
```

```bash
cd be && npx prisma generate --schema prisma/schema
```

```bash
cd be && npm run dev
```

With `EMAIL_PROVIDER=console` and `SHOW_OTP_IN_RESPONSE=true`, the login code
comes back in the HTTP response and is printed to the console, so the whole
flow is testable without sending mail. That flag is only honoured when the
provider is `console`, so production cannot leak codes this way.

### The `be` container serves stale code

`docker-compose.yml` defines a `be` service that runs the compiled `dist/`
from a built image. It does **not** pick up source changes, and its baked-in
`prisma/migrations` can be older than the repo's — it will report fewer
migrations than exist and then claim none are pending. For development, run
the API from source with `npm run dev` instead. If you do want the container:

```bash
docker compose up -d --build be
```

### Environment

`be/.env.example` is the template. `DATABASE_URL`, `JWT_SECRET` (16+ chars)
are required; `JWT_EXPIRES_IN` must look like `30d`/`12h`/`15m`/`60s` and is
checked at startup. `EMAIL_PROVIDER=resend` additionally requires
`RESEND_API_KEY`.

Sending real mail needs a verified sending domain. `EMAIL_FROM` defaults to
`no-reply@gatepass.app`; until that domain is owned and verified, Resend will
only deliver to the account's own address.
