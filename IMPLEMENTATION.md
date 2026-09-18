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
| Driver app | Expo (React Native), expo-router | Auth screens built; runs on web for development |
| Organizer dashboard | — | Not started |
| API | Fastify + TypeScript | ESM, `node --import tsx/esm` in dev |
| ORM | Prisma | Multi-file schema via `prismaSchemaFolder` |
| Database | PostgreSQL 16 | Docker, named volume `pgdata` |
| Validation | zod | At the request boundary, via `lib/request.ts` |
| Email | Resend, with a `console` provider for dev | `integrations/email/` |
| Auth | Email code (OTP) or Google, both issuing JWT sessions | See section 3 |
| Payments | Razorpay | **Not integrated yet** — only DB columns exist |

No logger. Fastify is constructed with logging disabled; a real setup comes
before production. Anything that must still be seen uses `console` directly:
the dev login code, startup failure in `index.ts`, integration retries, and
unhandled errors in `registerErrorHandler` (which previously called
`request.log.error` — a silent no-op once the logger was removed).

There is **no SMS/MSG91 integration** any more. Login codes and (eventually)
the QR pass both go out by email.

---

## 2. Layout

```
be/
  prisma/
    schema/             one .prisma file per domain
    migrations/         hand-written SQL, one per concern
  src/
    api.ts              all route registration
    config/env.ts       zod-validated environment
    constants/enums/    fixed-value domains, one file per enum (section 6)
    controllers/        HTTP shape only
    requests/           zod schemas per endpoint
    services/           business logic and Prisma access
    integrations/
      email/            Resend + console providers
      google/verify.ts  Google ID token verification
      http.ts           axios + retry
    middleware/         authenticate
    lib/                app, errors, prisma, request wrapper
fe/                     Expo app — see section 4 and fe/README.md
design/                 canvas source (.dc.html artboards + canvas.json)
```

Requests flow `route -> request(schema, handler) -> controller -> service`.
The `request()` wrapper in `lib/request.ts` validates `body`/`query`/`params`
and throws `ValidationError` before the controller runs, so controllers never
see unvalidated input.

---

## 3. Auth — built and tested

Email is the login identifier. `User.phone` still exists but is an optional
profile field, not a credential. There are two ways in, and both end in the
same `createSession()` and the same response shape:

```
{ token, user, profileComplete }
```

so the app routes on `profileComplete` without caring which path was used.

### 3a. Email code

There is **one** code flow behind both the Sign up and Sign in tabs. Sign up
sends a name; sign in does not. So signing up with an already-registered email
signs you in instead of erroring, and no endpoint reveals whether an address
has an account.

```
Sign up tab  ->  POST /auth/request-code { email, deviceId, deviceType,
                                           firstName, lastName }
Sign in tab  ->  POST /auth/request-code { email, deviceId, deviceType }

                 POST /auth/verify-code  { email, code, deviceId,
                                           deviceType, deviceName?,
                                           fcmToken? }
                   -> latest unverified, unexpired, not-burned row
                   -> code mismatch     => 400 "Invalid code. N attempts left."
                   -> mark row verified
                   -> user exists?  sign in, name untouched
                      user is new?  create with the name from the row
                   -> createSession(), issue JWT

                 profileComplete === false
                   -> app asks for a name
                   -> PATCH /auth/me { firstName, lastName? }
```

**Why the name sits on the verification row.** `request-code` stores
`firstName`/`lastName` on the `EmailVerification` row, not on a `User`. The
`User` row is created only once the code is confirmed, so an unverified email
can never produce an account. If the code expires, the pending name expires
with it.

### 3b. Rate limiting

A 6-digit code with unlimited tries is brute-forceable well inside its
5-minute expiry. Limits, all in `services/auth.service.ts`:

| Limit | Value | Response |
|---|---|---|
| Cooldown between codes, per email | 60 s | 429, with seconds to wait |
| Codes per email per window | 3 per 15 min | 429, with seconds to wait |
| Wrong guesses per code | 5 | 400 counting down, then 429 |

Past the guess cap, the row stops being selected at all — **the correct code
no longer works either**, and a fresh one is needed, which the per-email
limits then throttle. That combination is what actually closes the
brute-force path; the counter alone would not. Net effect: roughly 15 guesses
per 15 minutes per address, out of a million possible codes.

Stale rows are purged on each `request-code` for that address — only those
older than the rate window, since rows inside it are what the limit counts. No
scheduled job is needed.

### 3c. Google

```
App: expo-auth-session -> Google ID token
  -> POST /auth/google { idToken, deviceId, deviceType, deviceName?, fcmToken? }
  -> verifyIdToken: signature, issuer, expiry, aud in GOOGLE_CLIENT_IDS
  -> email_verified must be true
  -> match User.googleId, else User.email (links an email-code account),
     else create with Google's given/family name
  -> createSession(), issue JWT
```

Security choices, all load-bearing:

- **`aud` is pinned to our own client ids.** Without it, a token minted for
  any other Google app would authenticate here.
- **`email_verified` is required.** Google verifies gmail.com, but a Workspace
  domain can hold unverified addresses — and sign-in matches on email, so
  accepting those would let someone claim an address they do not own.
- **Email and name come only from the verified payload.** Nothing the client
  puts in the request body is trusted.
- **Failures return 401 without the reason** (the reason only helps an
  attacker tune). Missing configuration returns 503, not a fake "bad
  credentials".
- **`googleId` is matched before email**, because Google's `sub` is stable
  across a Google email change.

The app uses `expo-auth-session`, not `@react-native-google-signin`: it is not
a native module, so the same code runs on web and in Expo Go. It asks for an
ID token (`useIdTokenAuthRequest`), not an access token — only the former
proves identity.

### Rules that are easy to break later

- An existing account's name is **never** overwritten — by a resubmitted
  signup, or by Google. Google only fills a name that was null.
- `lastName` is optional everywhere. Mononyms are common in India, and a
  required surname would lock those users out.
- `profileComplete` is derived as `firstName !== null`, not stored.
- Email is trimmed and lowercased (zod on the code path, explicitly on the
  Google path), so `Ishan@Example.COM` and `ishan@example.com` are one account.

### Sessions

- JWT payload: `{ userId, email, role, sessionId, deviceId, deviceType }`,
  30-day expiry.
- One `UserSession` row per `(userId, deviceId)`, upserted — logging in again
  from the same device reuses its session rather than piling up rows.
- Every authenticated request re-checks that the session row still exists and
  has not expired, then refreshes `lastActiveAt`. So logout and remote logout
  take effect immediately with no token blocklist.
- `request.user` carries the payload, so handlers read the caller directly.

### Verified

Against a live database on 2026-09-18, all passing:

- **Email code:** signup with a name (`profileComplete: true`); sign-in with a
  new email (`profileComplete: false`, then `PATCH /auth/me`); email case
  normalisation; mononym with `lastName` null; registered email resubmitted
  with a different name (signs in, name preserved, same user id); per-device
  session reuse and the `current` flag on `GET /auth/sessions`.
- **Rate limits:** cooldown 429; window cap 429 with correct retry maths; guess
  countdown 4/3/2/1 then 429; the correct code rejected once the row is
  burned; stale-row purging.
- **In the browser:** the full signup and sign-in flows through the app,
  including the "attempts left" message.

**Google is not yet verified end to end.** Both typechecks pass and the button
renders correctly with and without a client id, but no real Google token has
been exchanged — that needs a Web client id (section 10) and migration 0010
applied (section 7).

---

## 4. Frontend

Full conventions are in [fe/README.md](fe/README.md). The rule is the
backend's: **the routing layer is thin, and the work lives behind it.**

```
fe/
  app/                  routes only: index, verify, profile, account
  src/
    api/
      client.ts         the only caller of fetch; ApiError carries HTTP status
      <domain>.api.ts   one file per domain, like be/'s services
    components/ui/      design system, one component per file, barrel-exported
    features/auth/      Google sign-in (hook + isolating component)
    hooks/              useAsyncAction: the busy/error/try-catch shape
    providers/          SessionProvider
    theme/tokens.ts     every colour, gap and radius
    constants/enums.ts  mirrors be/src/constants/enums/
    types/api.types.ts  API response shapes
```

- Imports use `@/` (→ `src/`), never `../..`.
- A raw hex or `fetch` call in a screen is a bug.
- Every pressable clears 44px.

Screens follow the published design canvas: dark brand header, first/last name
on one row, a six-box code input, a live resend timer matching the API's 60 s
cooldown, and a verified-email state on name capture.

Two decisions worth knowing:

- **The code input is six boxes over one hidden field**, not six inputs. That
  keeps paste, SMS autofill and backspace working.
- **The Google hook lives in its own component** (`GoogleSignIn`), mounted only
  when a client id is configured. `useIdTokenAuthRequest` *throws* without a
  client id rather than returning null; called from the screen directly, it
  took the whole sign-in screen down. Hooks cannot be called conditionally, so
  the component boundary is the guard. It also means there is never a dead
  Google button.

The session token is held in memory only — a reload signs you out. Persisting
it needs `expo-secure-store` on native and is a separate decision.

---

## 5. Data model

| Table | Purpose |
|---|---|
| `User` | `email` unique + required, `googleId` unique + nullable, `phone` optional, `firstName`/`lastName` nullable, `role`, `gstNumber`, `bankAccountId` |
| `EmailVerification` | 6-digit `code`, 5-minute expiry, `verified`, `attempts`, pending `firstName`/`lastName`; indexed on `(email, createdAt)` for rate limiting |
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

## 6. Enums are TEXT, not Postgres enums

Every fixed-value domain lives in `be/src/constants/enums/`, one file per enum,
re-exported from `index.ts`. The columns are plain `TEXT`.
`fe/src/constants/enums.ts` mirrors them — the two sides agree by convention,
so change both together.

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

## 7. Migrations

Hand-written SQL, one per concern, so each change is reviewable in isolation.

| Migration | Adds | Applied |
|---|---|---|
| `0001_enums` | The original Postgres enum types | yes |
| `0002_user` | `User` | yes |
| `0003_device_otp` | `DeviceType` + `OtpVerification` | yes |
| `0004_user_session` | `UserSession` | yes |
| `0005_base_tables` | `Listing`, `ParkingCapacity`, `Booking`, `Payment`, `Settlement`, `SettlementItem` | yes |
| `0006_email_auth` | Phone → email as the identifier; `OtpVerification` → `EmailVerification` | yes |
| `0007_enums_to_text` | All enum columns → `TEXT`; drops all 8 enum types | yes |
| `0008_split_user_name` | `User.name` → `firstName`/`lastName`; pending name on `EmailVerification` | yes |
| `0009_verification_attempts` | `EmailVerification.attempts`; `(email, createdAt)` index | yes |
| `0010_user_google_id` | `User.googleId`, nullable + unique | **no** |

**0010 is not yet applied** to the local database — Docker was down when it
was written. Until it is, `POST /auth/google` fails at runtime on the missing
column. Apply it with the command in section 10.

`0006` contains `DELETE FROM "User" WHERE "email" IS NULL` — a deliberate
dev-stage cleanup of phone-era users. **That line must never run against
production data.**

To write the next one with full control over the SQL:

```bash
npx prisma migrate dev --create-only --name <name> --schema prisma/schema
```

---

## 8. API surface

| Method | Path | Auth | State |
|---|---|---|---|
| GET | `/health` | — | Working; reports the email provider |
| POST | `/auth/request-code` | — | Working; rate limited |
| POST | `/auth/verify-code` | — | Working; guess-capped |
| POST | `/auth/google` | — | Built; needs migration 0010 and a client id |
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

## 9. What is not built yet

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
- **Google on native.** Only the web client id is wired for testing; iOS and
  Android client ids are needed once there is a dev build.
- **Razorpay.** No order creation, no webhook, no capture.
- **Settlement calculation.** Commission and payout maths are not written.
- **QR pass generation and delivery.**
- **Driver booking screens.** Designed (`design/EventDetail`, `Booking`,
  `Pass`) but not in a canvas yet and not built.
- **Session persistence** on the app (`expo-secure-store`).
- Organizer dashboard, geo-search, push notifications (the `fcmToken` column
  is reserved but unused), recurring/commercial listing types.

`JWT_SECRET` in the local `.env` is still a placeholder string. It passes the
16-character minimum, so validation will not catch it.

---

## 10. Local setup

Backend:

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

App, in a browser:

```bash
cd fe && npm run web
```

If `prisma generate` fails with `EPERM ... query_engine-windows.dll.node`, a
running API server is holding the engine file — stop it first.

With `EMAIL_PROVIDER=console` and `SHOW_OTP_IN_RESPONSE=true`, the login code
comes back in the HTTP response, is printed to the console, and is shown in a
yellow DEV box on the code screen — so the whole flow is testable without
sending mail. The flag is only honoured when the provider is `console`, so
production cannot leak codes this way.

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

`be/.env.example` and `fe/.env.example` are the templates.

Backend: `DATABASE_URL` and `JWT_SECRET` (16+ chars) are required;
`JWT_EXPIRES_IN` must look like `30d`/`12h`/`15m`/`60s` and is checked at
startup. `EMAIL_PROVIDER=resend` additionally requires `RESEND_API_KEY`.

Google sign-in needs an OAuth client from Google Cloud Console, with the same
id in both places — the app mints tokens with it, the API checks them against
it:

| File | Variable |
|---|---|
| `be/.env` | `GOOGLE_CLIENT_IDS` — comma-separated web, iOS, Android ids |
| `fe/.env` | `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (plus `_IOS_` / `_ANDROID_` later) |

Leave both empty and Google is simply off: the button is hidden and the
endpoint returns 503. Expo reads `EXPO_PUBLIC_*` at bundle time, so restart the
dev server after changing them.

Sending real mail needs a verified sending domain. `EMAIL_FROM` defaults to
`no-reply@gatepass.app`; until that domain is owned and verified, Resend will
only deliver to the account's own address.
