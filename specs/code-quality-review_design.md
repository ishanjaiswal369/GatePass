# Code quality review (2026-10-03) — findings and changes

A review of `be/` (Fastify + Prisma) and `fe/` (Expo) for security, structure,
standards and wasted work, with the fixes that were safe to make in place.
Nothing here changes a product rule or an API contract a client relies on.

## What was already right

Recorded so the next review doesn't re-check it:

- Layering is consistent: `api.ts` → `requests/` (zod) → `controllers/` →
  `services/`; the app keeps routes in `app/` and everything else in `src/`.
- No `any`, no `@ts-ignore`, `strict` on in both workspaces.
- Every raw SQL statement is a tagged template (`$queryRaw` / `Prisma.sql`);
  there is no string-built SQL.
- Authorisation is in the query (`driverId` / `hostProfileId` in the WHERE);
  admin and host checks read the database, not the token's claims.
- Money never comes from the client; webhooks are signature-checked over the
  raw body and then confirmed with the gateway.
- Secrets come only from `be/.env` through one validated module.

## Findings and what was done

### [Security]

| # | Finding | Change |
|---|---|---|
| S1 | Login, password-reset and account-deletion codes came from `Math.random()`, which is predictable | `crypto.randomInt` (`lib/secure.ts`) |
| S2 | Codes and the local-upload signature were compared with `!==` (timing-dependent) | constant-time compare (`lib/secure.ts`) |
| S3 | `jwt.verify` accepted any HMAC algorithm | pinned to HS256, for signing and both verifies |
| S4 | Device fields and the login password had no upper length (`deviceId` is stored and put in every token) | maximum lengths in `auth.request.ts` |
| S5 | Uploaded files are served from the API's own origin with no `nosniff` | `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` on every response |
| S6 | CORS reflected any origin in every environment | production allows only `APP_WEB_URL`; development is unchanged |
| S7 | The app made its device id and idempotency keys from `Math.random()` | `expo-crypto` `randomUUID()` |

### [Backend]

| # | Finding | Change |
|---|---|---|
| B1 | Every authenticated request made two database round trips for its session: a read, then a write of `lastActiveAt` | one read; the write only when `lastActiveAt` is over a minute old |
| B2 | Only `SIGINT` was handled, so `docker stop` (SIGTERM) waited out its timeout and killed the process mid-job | one shutdown path for both signals, run once |
| B3 | Services logged with `console.*` beside a structured logger | `app.log` with the error attached; provider "console" stand-ins and boot messages keep `console` |
| B4 | Admin queues and the driver's payment history were unbounded reads | capped (`take`) |
| B5 | The pricing step fetched the whole host summary to read one number | `GET /host/spots/:id` carries `serviceFeeRate` |

### [Frontend]

| # | Finding | Change |
|---|---|---|
| F1 | `GET /vehicles` was fetched by the search form, the results, the spot and the checkout: four identical calls in one booking | `lib/vehicleCache`: one read shared for a minute, refreshed by the vehicles screen after every change |
| F2 | The wizard's review step loaded its spot twice on opening | the first focus reuses what `useSpotDraft` just loaded |
| F3 | The pricing step called `GET /host/summary` (earnings, today's bookings, every space) for the fee rate | read from the spot it already has (B5) |
| F4 | Checkout refetched the spot and the payment options on every focus; only the vehicles can have changed | spot and options are kept for the visit, vehicles are re-read |
| F5 | Bookings refetched "am I parked?" on every tab change | read once per focus; a tab change reads only its list |
| F6 | Notifications loaded the settings for everyone who opened the inbox | settings load when that tab is first opened |
| F7 | Results re-ran the whole search every time the driver came back from a spot | skipped when the same search ran in the last 30 seconds; a spot saved on its own screen is carried back without a search |
| F8 | A non-JSON answer (a proxy's error page) threw a raw `SyntaxError`; a stalled request never ended | `client.ts` answers both as an `ApiError`, with a 20 s timeout |
| F9 | 90-odd raw hex colours in screens and components, against the app's own rule | tokens added to `theme/tokens.ts` and used; brand marks (UPI apps, Google) stay literal |

### [Tooling]

| # | Finding | Change |
|---|---|---|
| T1 | No single command checks the code | `npm run typecheck` in each workspace and at the root |

## Left for the owner to decide

Each is a real gap, and each needs a decision or a download that this review
shouldn't make on its own:

- **ESLint + Prettier + CI.** There is no linter (the app carries five
  `eslint-disable` comments for a linter that isn't installed) and no CI.
  Adding them means new dev dependencies and a workflow file.
- **Money columns are `DECIMAL(65,30)`.** `@db.Decimal(12, 2)` is the right
  type, and it is a schema change on every money column.
- **The API image.** `npm install` without a lockfile, dev dependencies in the
  runtime image, running as root, Node 20 in Docker against Node 22 in
  development. A multi-stage build fixes all four and needs testing with the
  mounted upload and secrets directories.
- **Long lists render every row** (`ScrollView` + `map` in bookings, results,
  notifications, host bookings). `FlatList` is the fix and changes those
  screens' layout code.
- **`fe/src/types/api.types.ts` mirrors the API by hand** (720 lines). Sharing
  the zod schemas, or generating the types, would stop them drifting.
- **Rate limiting and the password lock are in memory**: correct for one API
  process, wrong for two.
- **The notification job walks users one at a time.** Fine at this size;
  bounded concurrency when it isn't.
- **Big files** (`spot-listing.service.ts` 850 lines, `checkout.tsx` 575):
  worth splitting when next touched, not as a change of their own.

## Verification (2026-10-03)

- `npm run typecheck`: clean in both workspaces.
- `npm run test:cashfree` and `npm run test:refunds` (in process, fake
  gateway): all passed.
- `npm run test:api` against the API from source: 47 passed, 0 failed. It has
  to run with `PAYMENT_PROVIDER=none`: with Cashfree on, a booking rightly
  needs a phone number and a payable host, which this suite predates (19
  checks fail with `409 PHONE_REQUIRED`, before and after this review).
- The rebuilt container: `nosniff` on its responses; `docker compose stop be`
  takes under a second and exits 0, where it used to be killed at the
  timeout.
- The app in a browser, signed in with a test account, counting requests:
  - home: `/vehicles`, `/bookings/active`, `/notifications/unread-count`;
  - results → spot → back within 30 s: one `/spots/nearby`, one `/vehicles`;
  - checkout: `/spots/:id`, `/payments/options`, the quote; no `/vehicles`;
  - bookings: list + active on opening, the list alone on a tab change;
  - notifications: the inbox alone, `/settings` when that tab is opened.
- Not driven in a browser: the host screens (no host test account in the dev
  database) -- the pricing step's fee preview and the review step's single
  read are covered by the typecheck only. Nothing was run on the phone.
