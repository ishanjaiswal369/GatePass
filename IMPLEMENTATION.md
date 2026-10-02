# GatePass — Implementation Notes

Last updated: 2026-10-03

A paid marketplace for private parking in India. A host lists a space they
control -- a driveway, a garage, a bay in a society -- and drivers book it by
the hour or the day and pay in advance through Cashfree. Event parking and
organizers were removed on 2026-09-27: a `Listing` is always a host's spot.
There is no QR pass in v1 (removed 2026-10-01): a paid booking is confirmed
and releases the address and access instructions, and the host checks the
plate.

This document describes **what is actually built**, verified against the code
and a running database. Where something is scaffolding rather than working
behaviour, it says so — a previous summary document drifted ahead of the code
and became misleading, which is the mistake this file exists to avoid.

---

## 1. Stack

| Layer | Choice | Notes |
|---|---|---|
| App (driver and host) | Expo (React Native), expo-router | One app for both sides; runs on web for development and as an Android development build (`com.gatepass.app`) |
| API | Fastify + TypeScript | ESM, `node --import tsx/esm` in dev |
| ORM | Prisma | Multi-file schema via `prismaSchemaFolder` |
| Database | PostgreSQL 16 | Docker, named volume `pgdata` |
| Validation | zod | At the request boundary, via `lib/request.ts` |
| Email | Resend, with a `console` provider for dev | `integrations/email/` |
| Auth | Email code (OTP) or Google, both issuing JWT sessions | See section 3 |
| Payments | Cashfree PG + Easy Split | Order with each booking, UPI through Order Pay, payment / refund / vendor webhooks, refunds, and the host's share split on the order itself. Sandbox only so far. See section 8 and `specs/cashfree-payments_design.md`, `specs/cashfree-refunds_design.md` |
| Push | FCM, with a `console` provider for dev | `integrations/push/` |
| Uploads | Local disk behind signed, expiring URLs | `integrations/storage/` (`STORAGE_PROVIDER=local` is the only provider) |

Logging is pino through Fastify (`lib/app.ts`), level from `LOG_LEVEL`.
Per-request access lines are off; what is logged is logged on purpose:
security and audit events (`lib/security-log`), one line per gateway call,
and failures (`lib/errors`). The `authorization` and `cookie` headers are
redacted and no request body is logged. Services log through `app.log` with
the error attached; `console` is left to the boot messages and the "console"
stand-in providers.

Every response carries `X-Content-Type-Options: nosniff` and
`X-Frame-Options: DENY`. CORS allows any origin in development and only
`APP_WEB_URL` when `NODE_ENV=production`. The process shuts down cleanly on
both SIGINT and SIGTERM (so `docker stop` doesn't wait out its timeout).

A code review on 2026-10-03 made these and the app-side changes in section 4;
what it found, changed and left for a decision is in
`specs/code-quality-review_design.md`.

There is **no SMS/MSG91 integration** any more. Login codes go out by email.

---

## 2. Layout

```
be/
  prisma/
    schema/             one .prisma file per domain
    migrations/         hand-written SQL, one CREATE per table (section 7)
  src/
    api.ts              all route registration
    config/             env.ts (zod-validated environment), pricing.ts (service
                        fee, cancellation policy, extra-time steps)
    constants/enums/    fixed-value domains, one file per enum (section 6)
    controllers/        HTTP shape only
    requests/           zod schemas per endpoint
    services/           business logic and Prisma access
    integrations/
      email/            Resend + console providers
      geocode/          Ola + Google providers, off by default
      google/verify.ts  Google ID token verification
      payment/          gateway-neutral provider.ts + cashfree/
      push/             FCM + console providers
      storage/          local disk, signed URLs
      http.ts           axios + retry
    middleware/         authenticate, requireHost, requireAdmin
    lib/                app, errors, prisma, request wrapper, pagination,
                        listing-lock, stay-price, venue-time, security-log
fe/                     Expo app — see section 4 and fe/README.md
design/                 canvas source (.dc.html + canvas.json), splash render + philosophy
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
  30-day expiry, signed and accepted with HS256 only.
- One `UserSession` row per `(userId, deviceId)`, upserted — logging in again
  from the same device reuses its session rather than piling up rows.
- Every authenticated request re-checks that the session row still exists and
  has not expired. So logout and remote logout take effect immediately with
  no token blocklist. That is one read per request; `lastActiveAt` (the
  Devices list) is refreshed only when it is over a minute old, not on every
  call. A database failure here is a 500, never a 401: the app reads 401 as
  "signed out", and an outage must not sign everyone out.
- Login, reset and deletion codes come from `crypto.randomInt` and are
  compared in constant time (`lib/secure.ts`).
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

- **Google:** a forged token is rejected with 401 (503 when no client id is
  configured, so the 401 proves the id is read). A real Google sign-in through
  the app created a new user with `googleId` set and first/last name taken
  from Google's given/family name, so it skipped name capture.

Not yet exercised: linking an **existing** email-code account to Google on its
first Google sign-in (the email-fallback branch), and Google on iOS/Android.

---

### Passwords

A password is an **addition**, not a replacement: email codes and Google
sign-in are untouched, and `User.passwordHash` stays null for most accounts.
It is set from the profile screen or through forgot-password — the same two
endpoints serve both, because both have to prove the email either way, so
neither requires a session.

- **`EmailVerification.purpose` is what makes this safe.** `verifyCode` picks
  the newest unverified row for an address, so without a purpose a
  password-reset code would sign its holder in and a login code would let
  someone set a password. Both flows filter on it, and the rate limit counts
  per purpose so one cannot exhaust the other's allowance.
- **Setting a password revokes every existing session** and issues a fresh
  one. For forgot-password that is the point: whoever else was signed in is
  cut off. It also means the signed-in profile flow ends holding a working
  token instead of being logged out by its own success.
- **Hashing is scrypt from `node:crypto`** — no dependency, and no native
  module to build in the Alpine image, which is what bcrypt and argon2 both
  bring. Cost parameters live inside the stored value
  (`scrypt$N$r$p$salt$hash`), so they can be raised later without
  invalidating existing hashes.
- **Nothing reveals whether an address is registered.** `password/request-code`
  answers identically for a known and an unknown email; `login` returns one
  message for a wrong password, an unknown account and an account with no
  password, and runs the hash comparison against a dummy value in the last two
  cases so the timing matches.
- Passwords have a **minimum length and no composition rules**. "One capital,
  one symbol" pushes people towards shorter, more guessable passwords and
  breaks password managers; length is what costs an attacker.

**Changing a known password** is a separate, signed-in endpoint,
`POST /auth/password/change { currentPassword, newPassword }`, with no
emailed code — proving the current password is the check.

- **The caller's own session survives; every other one is revoked.** That is
  the opposite of `password/set`, deliberately: the person changing it has just
  proven who they are, and a change is usually a reaction to someone else
  having the password.
- **A wrong current password answers 400, not 401.** The session is valid; a
  401 would read to the app as "you are signed out".
- **Five wrong current-password guesses lock the endpoint for that user for
  15 minutes**, and during the lock even the right password is refused.
  Without that, a stolen session would be a way to guess the password and reuse
  it wherever the owner reuses it. The counter is **in memory**: it resets when
  the API restarts and is not shared between instances, so it has to move to
  the database or Redis before the API runs as more than one process.
- The new password must differ from the current one, and accounts with no
  password yet (code-only, Google) are told to set one by emailed code.
- The current password is not checked against `passwordSchema`, so one that
  predates a rule change can still be changed.

Verified 2026-09-19 against the running API, 12/12: no-password account
refused; wrong current with the attempts count; same-as-current; too-short
new; no token → 401; success reports one other device signed out; own session
still works; the other device's is revoked; old password no longer logs in;
new one does; after five wrong guesses the right password is refused with 429.
Also driven through the app in the browser.

### Profile

- **Phone is normalised to `+91XXXXXXXXXX` at the request boundary**, so the
  unique column cannot hold `9876543210` and `+91 98765 43210` as two rows for
  one number. Only mobile prefixes (6-9) are accepted — Cashfree's
  `customer_phone` and a call at the gate both assume a mobile. **The number
  is stored unverified**; there is no phone OTP yet.
- **Vehicle numbers are normalised too** (uppercase, separators stripped), so
  the unique index really does stop the same plate being saved twice. The
  format check is deliberately loose: Indian plates span state series, the BH
  series and older formats, and a strict regex rejecting a real plate is a
  worse failure than storing an odd one.
- **Exactly one vehicle is the default.** The first one saved becomes it
  whatever the caller asked for, promoting a new default clears the old one in
  the same transaction, and deleting the default promotes the oldest
  remaining.
- `UserAddress` is where the user lives. A spot's address is on the `Listing`
  that describes it, not on `HostProfile` — a host can list several spots at
  several addresses, and one row could only ever hold the last one saved.
- **`/auth/me` eager-loads vehicles and address** in the same Prisma query as
  the user (`userService.getProfile`, with `include`), and also derives
  `hasHostProfile` from that include rather than a second lookup. The profile
  hub went from three requests (`/auth/me`, `/vehicles`, `/address`) to one.
  `GET` and `PATCH /auth/me` share one response builder (`meResponse` in
  `auth.controller.ts`) so their shapes cannot drift. `/vehicles` and
  `/address` still exist for the edit screens; vehicle order is one shared
  constant, `VEHICLE_ORDER`, so both routes list them identically.

### Account deletion — soft

`POST /auth/account/delete { code }` **soft-deletes**: the `User` row and
everything attached to it (profile, vehicles, address, bookings, payments,
host profile) stay exactly as they were, and `User.deletedAt` is stamped.
Nothing is scrubbed, so restoring an account later is a matter of clearing `deletedAt`. A hard delete was not an option anyway:
`Booking.driverId` has no cascade, so the database refuses it for anyone who
has booked, and cascading a host profile would orphan pending payouts.

What deletion does change:

- **Every session is revoked**, this device included.
- **Every sign-in path refuses the account** with 403 "This account has been
  deleted.": code verify, Google, password login, password set.
  `assertNotDeleted()` in `auth.service.ts` only runs *after* the caller has
  proven the identity (right code, verified Google token, right password), so
  it tells nothing to someone who does not own the address. A wrong password
  still gets the generic 401, and `request-code` / forgot-password answer
  exactly as for an unknown address.
- **A host's spot leaves search**: its listings go to `CANCELLED` and its
  availability windows are switched off. Restoring would need the host to
  re-enable them.
- Because the email stays on the row, **the same email cannot sign up again**
  while the account is deleted. Restoring is the way back.

**It needs an emailed code** (`/auth/account/delete/request-code`, purpose
`ACCOUNT_DELETE`, same attempt cap as login), so an unlocked phone or a stolen
session cannot delete an account. The address is taken from the session,
never the request. **Blockers are checked before a code is sent and again
before deleting** (`GET /auth/account/deletion` lists them): an upcoming
(`PENDING`/`CONFIRMED`) booking as a driver, or upcoming bookings at the
user's spot. Each is a person who would be left stranded.

Soft deletion keeps personal data. If a user asks for erasure under India's
DPDP Act, that is a separate step — a purge job that scrubs the PII of rows
deleted long enough ago — which does not exist yet.

Verified 2026-09-19 against the running API, 25/25: eager-loaded vehicles and
address on GET and PATCH; no blockers on a clean account; wrong code with
attempts; no token 401; delete 204; both devices signed out; row, name,
password, vehicle and address all still present with `deletedAt` set; wrong
password 401 vs right password 403; forgot-password silent; login code
request 200 but verify 403; host listing `CANCELLED` with host profile kept;
an open booking blocking the driver (409 before any code is sent) and the
host of that spot, both unblocked once it completed. Also driven through the
app end to end.

---

## 4. Frontend

Full conventions are in [fe/README.md](fe/README.md). The rule is the
backend's: **the routing layer is thin, and the work lives behind it.**

```
fe/
  index.js              entry point; must live here, not in node_modules
  metro.config.js       workspace resolution (see below)
  app/                  routes only: index, verify, profile, home, parking,
                        spots/* (results, filters, a spot, checkout),
                        bookings, booking/[id]/* (pay, confirmed, extend,
                        cancel, problem, review), host, host/spot/* (the
                        wizard), host/listing/[id], host/bookings,
                        host/earnings, payouts, notifications, password,
                        account/*, and the public policy pages
  src/
    api/
      client.ts         the only caller of fetch; ApiError carries HTTP status
      <domain>.api.ts   one file per domain, like be/'s services
    components/ui/      design system, one component per file, barrel-exported
    features/auth/      Google sign-in (hook + isolating component)
    hooks/              useAsyncAction (busy/error shape), useDriverLocation,
                        useScreenInsets (safe areas)
    lib/                storage (SecureStore/localStorage), tokenStore, deviceId
    providers/          SessionProvider
    theme/tokens.ts     every colour, gap and radius
    constants/enums.ts  mirrors be/src/constants/enums/
    types/api.types.ts  API response shapes
```

- Imports use `@/` (→ `src/`), never `../..`.
- A raw hex or `fetch` call in a screen is a bug. (Since 2026-10-03 there are
  none: every colour is a token in `theme/tokens.ts`, except brand marks --
  the UPI apps' and Google's.)
- Every pressable clears 44px.

### Reading from the API without waste

The app has no data cache library; each screen reads what it shows, on focus.
Four rules keep that from turning into repeated requests:

- **Vehicles are read once and shared** (`lib/vehicleCache`). The search
  form, the results, the spot and the checkout all need them; they share one
  read for a minute. The vehicles screen reads fresh after every change, and
  that replaces what is shared.
- **A screen doesn't re-read what cannot have changed.** Checkout keeps the
  spot and the payment options for the visit and re-reads only the vehicles;
  Bookings asks "am I parked?" once per focus, not on each tab change;
  Notifications reads the settings when that tab is first opened; the
  wizard's review step doesn't re-read the spot `useSpotDraft` just loaded.
- **Results don't search again on the way back from a spot.** The same search
  within 30 seconds keeps its list, scroll position and pin; a heart changed
  on the spot's screen is carried back through `lib/savedSpots`.
- **One number isn't worth a request.** The pricing step's fee preview reads
  `serviceFeeRate` off the spot it already has.

`api/client.ts` turns every failure into an `ApiError`: no connection or a
request stalled past 30 seconds is status 0, and an answer that isn't the
API's JSON is reported under its own status rather than thrown as a parse
error. Ids the app makes (device id, idempotency keys) come from
`expo-crypto` (`lib/randomId`), not `Math.random`.

Screens follow the published design canvas: dark brand header, first/last name
on one row, a six-box code input, a live resend timer matching the API's 60 s
cooldown, and a verified-email state on name capture.

### Profile

`app/account.tsx` is a hub rather than a form: each row shows what that
section currently holds, so "have I filled this in?" is answered on one screen
instead of one tap inside each of them. Editing happens in
`account/details`, `account/vehicles` and `account/address`.

- **The hub is one request**: `/auth/me` carries vehicles and address, so the
  rows come from that alone.
- **Log out is a pill in the header's top-left** (`HeaderAction`, through
  `ScreenHeader`'s `leading` slot), with the avatar moved to the right. It is
  built from the same raised-ink surface as the avatar so the two read as a
  pair, and it clears 44px through `hitSlop` while staying 34px tall.
- **Delete account sits at the bottom** as a `danger` button, and opens
  `account/delete`: what deletion does, any blockers (shown before a code is
  ever requested), then the emailed code in the six-box input and a final
  "Delete my account". On success it signs out locally and returns to sign-in.

- **The hub refetches on focus, not on mount.** Returning from a sub-screen
  does not remount it -- the hub is still on the stack -- so a plain
  `useEffect` leaves every row showing whatever was true when it first opened.
  Saving an address and coming back then read "Not set" while the database
  held it, which looks like a failed write and is not one. `useFocusEffect`
  from expo-router is the fix, and the same trap applies to any screen that
  displays something an inner screen can change.
- **Every screen leads with `ScreenHeader`**, the same ink band and 22px
  bottom corners as the home screen, so the profile reads as part of the app
  rather than a settings page bolted on. It owns the safe-area inset, which is
  why the screens under it no longer take one.

- **`app/password.tsx` holds every password path.** Signed in with a password
  it opens on **change**: current, new and confirm
  (`features/auth/ChangePasswordForm`), with a "Forgot it?" link into the
  emailed-code flow. Signed in without a password it is "set a password" by
  code; signed out it is forgot-password. When the address is already known it
  is not editable, because changing it there would mail a code to someone
  else's inbox. After a change it shows how many other devices were signed out.
- **The mode and the signed-in email are derived on every render, never held
  in initial state.** After a reload `user` is null for the first render while
  the session restores; a `useState(user?.email)` initialiser captured that
  null, which left the reset flow with an empty address and a disabled button.
  That was a real bug, found while building the change form.
- **Setting a password adopts the returned token.** The API revokes every
  earlier session, so the one the app was holding stops working at that exact
  moment; ignoring the new token would log the user out of their own success.
- **The phone field edits ten digits with a fixed `+91` prefix.** Non-digits
  are stripped as they are typed, so the value cannot drift from what the API
  will accept, and the prefix is shown rather than typed.
- **Vehicle numbers uppercase as you type**, matching how the API stores them,
  so what the driver sees is what gets saved.
- **Country on the address screen is text, not a one-option picker.** The API
  refuses to take it from the client; a control that cannot change anything
  only invites the question.
- Password sign-in is **opt-in on the sign-in tab**, not a third segment:
  codes stay the default and most accounts have no password.

### Driver home

`app/home.tsx` answers the two questions a driver arrives with, and nothing
else: "am I parked?" and "where do I park?". The product leads with a search,
not a feed.

- **Already parked / Book parking** is the segment under the header. Already
  parked opens the running stay (`/parking`); Book parking is the search form
  (`features/search/BookParkingForm`), which opens `spots/results` with the
  chosen hours and vehicle.
- **Two calls, on focus rather than on mount**: `GET /bookings/active` and
  `GET /notifications/unread-count` for the bell's badge. The screen stays
  mounted under the booking flow, so a mount-only fetch would miss a stay
  that started meanwhile. Both fail quietly: not being parked is the normal
  state of this screen.
- `GET /bookings/active` answers 200 with `booking: null`, so "nothing
  running" is a layout state rather than an error.
- **The bottom nav is Home, Bookings, Host, Payouts, Profile.**
- **Host is one nav item, not a mode switch.** It opens onboarding or the
  dashboard depending on `user.hasHostProfile`, which the session holds.
  - Every sign-in response carries it (code, Google, password login, password
    set and change, all through `sessionUser()` in `auth.service.ts`), as
    well as `/auth/me`. Before, only `/auth/me` did, so straight after a
    login the app did not know and `host.tsx` fetched `/host/profile` just to
    find out. The field existed for exactly this but nothing read it.
  - A known non-host now gets onboarding with **no request at all**; a known
    host sees the "Your spot" frame immediately while its details load.
  - It is derived from whether a `HostProfile` row exists, not a role: a
    user can be a driver and a host at once. It becomes true when the first
    listing is named (`POST /host/spots`, see the wizard below) and never
    goes back to false.

### The host listing wizard

Nine steps under `app/host/spot/`, in the order `constants/wizard.ts` lists
them: **type, address, photos, details, availability, pricing, access,
documents, review**. Each step is its own URL and its own request against the
same listing, so a host who closes the app mid-way picks up where they were —
nothing is held between screens. `useSpotDraft` reads the listing from the
server on every step, keyed by the `?id=` the steps carry forward.

- **The name comes first, because the first step is what creates the row.**
  It used to open a blank listing called "New spot" and ask for the name on a
  later screen, so everyone who opened the wizard and backed out left a
  nameless draft on their dashboard — several of them, indistinguishable from
  each other. `POST /host/spots` now takes the name, and nothing exists until
  it is given.
- **That same request makes a first-time host a host**, which is why it is the
  one route in this group not behind `requireHost`. There is no separate
  onboarding step and no `POST /host/profile` any more: a `HostProfile` is
  created alongside the listing, in `spotListingService.createSpot`.
- **`HostProfile` has no address.** A spot's address lives on the `Listing`
  that describes it, because a host with two driveways has two. A host
  profile is now the answer to "is this user a host", and where they live is
  `UserAddress`.
- **Availability is days *and* hours.** The screen offers Every day / Working
  week / Custom for the days, an "open 24 hours" switch, and a from–to range;
  "different hours on some days" opens a row per day, which is what the API
  has always stored. Times are minutes from midnight, `1440` meaning midnight
  *closing* — rendering that as `00:00` made a window read as broken. The
  picker is a list in a modal, not a platform date picker, for the same reason
  auth uses `expo-auth-session`: no native module, so it runs on web too.
- **Overlapping windows are refused twice.** The request schema names the day
  it went wrong; the database's `EXCLUDE` constraint is what actually holds,
  because two concurrent requests can each pass a check the other invalidates.
- **Payout is not a wizard step.** The payout account is the host's, not a
  listing's, so it is set up once on the Payouts tab (`app/payouts`): PAN and
  bank details go to Cashfree as an Easy Split vendor and are read back
  masked. A listing is submitted without it and goes live once the account is
  `ACTIVATED` and the ownership document is approved, in whichever order
  those arrive. Design: `specs/cashfree-payments_design.md` ("Host payout
  account").
- **Back always moves.** Every step is a real URL, so a host can land on one
  cold — a reload, a link, a `replace` that ended the previous flow — where
  `router.back()` does nothing at all and reads as a broken button.
  `useWizardBack` falls back to the previous step's own path, and to `/host`
  before the first step.
- **The dashboard is one call.** `GET /host/spots` carries each spot's own
  availability and the host's payout status, so `app/host.tsx` makes one
  request where it used to make three. It refetches on focus, not on mount —
  the wizard runs on top of it and returns without remounting.
- **The header is light, not the dark ink band.** `SectionHeader` is shared by
  every wizard step and by the listing status screen. The dark `ScreenHeader`
  marks a screen reached from the app's chrome; partway through the Host tab
  it reads as having left the section, which is exactly how the status screen
  looked before.

Three decisions worth knowing:

- **The code input is six boxes over one hidden field**, not six inputs. That
  keeps paste, SMS autofill and backspace working.
- **The Google hook lives in its own component** (`GoogleSignIn`), mounted only
  when a client id is configured. `useIdTokenAuthRequest` *throws* without a
  client id rather than returning null; called from the screen directly, it
  took the whole sign-in screen down. Hooks cannot be called conditionally, so
  the component boundary is the guard. Without a client id, production hides
  the button; development shows it disabled with a one-line hint naming the
  variable to set (`GoogleSignInUnconfigured`, which mounts no hook), because a
  silently missing button read as a missing feature.
- **`index.js` and `metro.config.js` are both load-bearing.** Dependencies
  hoist to the repo root in this npm workspace, so `fe/node_modules` is nearly
  empty. `metro.config.js` points `watchFolders` and `nodeModulesPaths` at the
  workspace root so Metro can resolve anything at all.

  The entry point is a second, separate trap. `"main": "expo-router/entry"`
  resolves to the hoisted copy *outside* Metro's project root, so Expo writes
  the `<script>` URL as a relative path to it — and that breaks differently on
  each OS. On macOS and Linux it is `/../node_modules/expo-router/entry.bundle`
  and the browser strips the `/..`, so the request 404s. On Windows the
  separators are backslashes, so it arrives percent-encoded as
  `..%5Cnode_modules%5C...` and Metro answers 500. **Both fail as a blank white
  page with nothing in the terminal.** `fe/index.js` re-exports
  `expo-router/entry` from inside the project, which makes the URL a plain
  `/index.bundle` everywhere. Do not point `main` back at the package.
- **The session survives a reload**, and restoring it is asynchronous.
  `SessionProvider` keeps the token in `expo-secure-store` on native and in
  `localStorage` on web (SecureStore has no web implementation). The stored
  token is not trusted on sight: restoring calls `/auth/me` once and keeps it
  only if the API still accepts it, since the session row can be revoked from
  another device. While that is in flight `isRestoring` is true, and **every
  protected screen must wait for it** -- a guard that reads `token === null`
  on first render sends a signed-in user to sign-in before the token loads,
  which looks exactly like the persistence not working.
- **Nothing assumes a browser.** `PhoneFrame` simulates a handset on web and
  is a plain full-bleed `View` on native, or a phone would render the app as a
  rounded card floating inside its own screen. Screens take their top padding
  from `useScreenInsets()` rather than hardcoding it -- real safe-area insets
  on a device, a fixed stand-in for the status bar on web -- so a dark header
  reaches the top edge while its content clears the notch. Anything stored
  goes through `lib/storage`, which is SecureStore on native and localStorage
  on web; **`localStorage` must never be reached for directly**, because on
  native it silently does not exist. That is what made `deviceId` regenerate
  on every launch and open a fresh `UserSession` row each time.
- **An auth gate is a `<Redirect>`, never `router.replace` in an effect.** A
  child screen's `useEffect` runs before the root layout has mounted its
  navigator, so a cold load of `/account` while signed out crashed with
  *"Attempted to navigate before mounting the Root Layout component"*. A
  reload restores the session asynchronously, so every page reload on a
  protected route hits exactly that path. A redirect element is rendered rather than
  run, so it cannot fire early. Navigating from a press handler is fine --
  those happen long after the navigator is ready.

### Splash

`assets/splash.png` (1284×2778) is the opening brand image: the barrier mark,
the wordmark and the line "PARKING BY THE HOUR OR DAY" on the app's ink, above
a day drawn as a scale -- an hour stroke from 00 to 24 -- with one span of it
(13 to 16) raised into a parking bay. Until 2026-10-03 the line read "PARKING
FOR TICKETED EVENTS" over a row of nine bays. Design rationale:
`design/splash-philosophy.md`. The native splash is baked into the build, so
changing the image needs `npx expo prebuild` and a new build, not just a
reload.

The one image is used twice:

- **Native splash** in `app.json`, on `#111827` so other aspect ratios
  letterbox seamlessly.
- **`BrandSplash`**, an overlay in the root layout that holds it ~2.2 s on
  cold start and fades out over the first screen, sharing `PhoneFrame`'s
  footprint so the reveal lands in place. On a device the hand-off from the OS
  splash is invisible; on web, which has no native splash, it is the only
  place the splash appears. It lives in root state, so navigation never brings
  it back.

---

## 5. Data model

| Table | Purpose |
|---|---|
| `User` | `email` unique + required, `googleId` unique + nullable, `phone` optional (E.164 `+91…`), `passwordHash`/`passwordSetAt` nullable, `firstName`/`lastName` nullable, `role`, `deletedAt` nullable (soft delete) |
| `EmailVerification` | 6-digit `code`, 5-minute expiry, `verified`, `attempts`, `purpose`, pending `firstName`/`lastName`; indexed on `(email, purpose, createdAt)` for rate limiting |
| `Vehicle` | saved number plate + type per user, one `isDefault`; unique on `(userId, vehicleNumber)` |
| `UserAddress` | the driver's own address, 1:1 with `User`; `country` fixed to India |
| `UserSession` | per-device session, `deviceId`, `fcmToken` (this device's push token; cleared on logout, expiry, or when another account signs in on the device), `lastActiveAt`, `expiresAt` |
| `UserSettings` | one row of settings per user (boolean/string columns), created on first change; absent = defaults. Holds the notification switches and the `push`/`email`/`offers` channels. `GET`/`PATCH /settings` |
| `Notification` | the in-app inbox, which is also the push outbox (`pushedAt`) |
| `Listing` | a host's parking space; `hostProfileId` is required (`Listing_has_host` CHECK) and `listingType` is always `INDEPENDENT_SPOT`. The address is split into what is public (society, area) and what is released only with a paid booking (building, street, access instructions, bay). Carries the review trail: `submittedAt`, `docApprovedAt`, `rejectionReason` / `rejectionSection` |
| `HostProfile` | 1:1 optional on `User`. Its existence *is* the answer to "is this user a host" -- never `role`. Holds no address. Holds the payout account: bank details (read back masked), the Cashfree vendor id (`payoutAccountId`) and `payoutKycStatus` mirrored from the gateway |
| `HostAvailability` | weekly windows for one spot: `dayOfWeek`, minute range, `isActive` toggle. Scoped to the `Listing`, not the host, with a DB `EXCLUDE` against overlaps. Price is **not** here -- see `SpotPricing` |
| `SpotPhoto` / `SpotPricing` | a spot's photos in display order, and one rate per vehicle type: `pricePerHour` and/or `pricePerDay` (a stay is charged the cheaper of the two) |
| `Favorite` | a spot a driver saved; one row per `(user, listing)` |
| `ListingBlock` | hours a host took off sale. Not a booking, so bookings, extensions and blocks check each other inside a per-listing advisory lock (`lib/listing-lock`) |
| `Booking` | a stretch of time on one spot: `startsAt`/`endsAt`, `holdExpiresAt` for an unpaid hold, `extendsBookingId` for extra time, `amount` snapshot, `status`, `idempotencyKey` unique. `Booking_no_overlap` EXCLUDE stops two drivers holding overlapping hours |
| `Payment` | one per booking, written in the booking's transaction. Separate from `Booking` because payment state and booking state are different machines; gateway-neutral `gateway*` ids, plus the host's split (`splitVendorId`, `splitAmount`) fixed when the order is first opened |
| `Refund` | one per booking, opened inside the transaction that decides it. `REFUND_PENDING → REFUNDED / FAILED`, with the gateway ids, the host's part (`splitAmount`), `attempt` (1-3) and `failureReason` |
| `HostPayout` | one row per Cashfree settlement to a host's bank, written only from the Easy Split settlement webhook: `INITIATED → SUCCESS / FAILED`, `SUCCESS → REVERSED` |
| `ProblemReport` | a driver's "I can't use this parking" report on a booking, resolved by an admin; upheld means a full refund |
| `Review` | a driver's review of a stay (drivers review spots; hosts do not review drivers) |

`createdBy`/`updatedBy` columns exist on `Listing`, `Booking` and `Payment`,
and their creation populates them.

**Driver and host are not roles.** A person can be both at once, which one
`role` column cannot express. `User.role` still exists and is used for `ADMIN`
only; `DRIVER` is simply "any signed-in user". Host status is a `HostProfile`
row, checked in the database on every request -- never baked into the JWT,
which would be stale for the token's full 30-day life.

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
unrecognised value. `Booking.status`, `Payment.status` and `Refund.status`
decide where money goes, so a bad value there is a money bug, not a display
bug. Writes to those columns must keep going through the
validated request layer — a manual SQL fix or a future service writing
directly can store a status the app will not understand. If that guarantee is
wanted back later, a `CHECK` constraint is easier to change than a Postgres
enum.

---

## 7. Migrations

One `CREATE TABLE` per table, in foreign-key order: each migration holds its
table, its indexes, its foreign keys (all to tables created earlier), and any
raw SQL Prisma cannot model. There are no `ALTER`s or data fixes -- the dev
history (26 incremental migrations) was squashed while every database could
still be rebuilt, and the result was checked column-for-column,
constraint-for-constraint against a database built the old way.

| Migration | Creates |
|---|---|
| `0001_create_user` | `User` |
| `0002_create_email_verification` | `EmailVerification` |
| `0003_create_user_session` | `UserSession` |
| `0004_create_vehicle` | `Vehicle` |
| `0005_create_user_address` | `UserAddress` |
| `0006_create_user_settings` | `UserSettings` (replaced `NotificationPreference`) |
| `0007_create_notification` | `Notification` |
| `0010_create_host_profile` | `HostProfile` |
| `0011_create_listing` | `Listing` + `Listing_has_host` CHECK |
| `0012_create_host_availability` | `HostAvailability` + day/minute range CHECKs, `btree_gist`, `HostAvailability_no_overlap` EXCLUDE |
| `0014_create_spot_pricing` | `SpotPricing` |
| `0015_create_spot_photo` | `SpotPhoto` |
| `0016_create_favorite` | `Favorite` |
| `0017_create_listing_block` | `ListingBlock` |
| `0018_create_booking` | `Booking` + `Booking_one_target` CHECK, `Booking_no_overlap` EXCLUDE |
| `0019_create_payment` | `Payment` |
| `0020_create_refund` | `Refund` |
| `0021_create_problem_report` | `ProblemReport` |
| `0022_create_review` | `Review` |
| `0025_create_host_payout` | `HostPayout` |

The gaps in the numbering are tables that no longer exist: `Organizer`,
`OrganizerMember` and `ParkingCapacity` went with event parking, and
`Settlement` / `SettlementItem` (the manual payout ledger) went when Easy
Split took over paying hosts, both on 2026-09-27.

`npx prisma migrate deploy --schema prisma/schema` builds a fresh database;
`migrate diff --from-migrations … --to-schema-datamodel …` must report no
difference. A schema change during development edits the table's `.prisma`
file and its `create_*` migration together (see the README). That stops
working at the first production deploy: from then on, changes are new
additive migrations.

---

## 8. API surface

Everything requires a JWT except: `/health`, the `/auth/*` sign-in calls,
`POST /webhooks/cashfree` (authenticated by Cashfree's signature over the raw
body), `GET /payments/return` (only redirects to the booking's pay screen)
and `/uploads/*` (local storage; the signed, expiring URL is the credential).
"Host" means a JWT plus a `HostProfile` row; "Admin" means `role = ADMIN`.

| Method | Path | Auth | State |
|---|---|---|---|
| GET | `/health` | — | Working; reports the email provider |
| POST | `/auth/request-code` | — | Working; rate limited |
| POST | `/auth/verify-code` | — | Working; guess-capped |
| POST | `/auth/google` | — | Working; needs a client id configured |
| GET | `/auth/me` | JWT | Working; `profileComplete`, `hasHostProfile`, and eager-loaded `vehicles` + `address` |
| PATCH | `/auth/me` | JWT | Working; returns the same shape as GET |
| GET | `/auth/account/deletion` | JWT | Working; lists what blocks deletion |
| POST | `/auth/account/delete/request-code` | JWT | Working; mails an `ACCOUNT_DELETE` code, 409 if blocked |
| POST | `/auth/account/delete` | JWT | Working; soft-deletes, 204 |
| POST | `/auth/password/request-code` | — | Working; mails a `PASSWORD_RESET` code |
| POST | `/auth/password/set` | — | Working; sets the password, returns a session |
| POST | `/auth/login` | — | Working; email + password |
| POST | `/auth/password/change` | JWT | Working; current + new password, keeps own session |
| GET/POST/PATCH/DELETE | `/vehicles` | JWT | Working |
| GET / PUT | `/address` | JWT | Working |
| POST | `/auth/logout` | JWT | Working |
| GET / DELETE | `/auth/sessions` | JWT | Working |
| GET / POST | `/notifications`, `/notifications/unread-count`, `/notifications/read` | JWT | The inbox, the bell's badge, mark as read |
| PUT / DELETE | `/notifications/push-token` | JWT | This device's FCM token, stored on the caller's own session |
| GET / PATCH | `/settings` | JWT | `UserSettings`: notification switches and channels |
| GET | `/spots/nearby` | JWT | Search: open for the whole stay, not already booked or held, not blocked by the host |
| GET | `/spots/:id`, `/spots/:id/quote`, `/spots/:id/reviews` | JWT | A spot, the checkout's price (the same function the booking charges with), its reviews |
| GET / PUT / DELETE | `/favorites`, `/favorites/:id` | JWT | Saved spots |
| GET | `/geocode`, `/geocode/autocomplete`, `/geocode/place/:placeId`, `/geocode/reverse`, `/geocode/static-map` | JWT | Working when a provider is configured, else 503. The static map is proxied because the upstream URL carries the API key |
| GET | `/bookings` | JWT | Driver-scoped, cursor paginated |
| GET | `/bookings/active` | JWT | The stay running now; 200 with `booking: null` when there is none |
| GET | `/bookings/:id` | JWT | Also checks an open payment and a pending refund with Cashfree, throttled |
| POST | `/spot-bookings` | JWT | A 15-minute hold, its `Payment` row and the Cashfree order, in one request; idempotent |
| POST | `/bookings/:id/pay/upi` | JWT | Order Pay: UPI intent links or a QR for the booking's (or extension's) order |
| GET | `/payments`, `/payments/options` | JWT | The driver's own payments, no gateway ids, and what the pay screen offers. No POST: the row is opened with its booking |
| GET | `/payments/return` | — | Where Cashfree's page sends the driver back; redirects to the pay screen |
| POST | `/webhooks/cashfree` | Signature | Payment, refund, vendor-status and vendor-settlement webhooks, routed by `type`. The body only names the thing; its state is then asked of Cashfree |
| GET / POST | `/bookings/:id/cancellation`, `/bookings/:id/cancel` | JWT | The quote first, then the cancel; opens a `Refund` by the policy in `config/pricing.ts` |
| GET / POST | `/bookings/:id/extensions` | JWT | Extra time (30 / 60 / 120 min), held and paid like a booking |
| GET / POST | `/bookings/:id/problem`, `/bookings/:id/problem/photo-upload-url` | JWT | "I can't use this parking", with photos |
| POST | `/bookings/:id/review` | JWT | The driver's review of the stay |
| GET | `/host/profile` | JWT | `profile: null` for a non-host |
| GET | `/host/spots` | Host | Every spot with its hours, plus the payout gate — the whole dashboard in one call |
| POST | `/host/spots` | JWT | Opens a **named** listing, and makes the caller a host if they were not one |
| GET / DELETE | `/host/spots/:id` | Host | Delete is a soft cancel |
| PATCH | `/host/spots/:id/{type,address,photos,details,features,limits,booking-rules,permission,ownership-document,terms,pricing}` | Host | One wizard step (or part of one) each |
| PUT | `/host/spots/:id/availability` | Host | Replaces the week |
| POST | `/host/spots/:id/{photo,document}-upload-url` | Host | A signed, expiring upload URL (with local storage, a `PUT /uploads/*` on this API) |
| GET | `/host/spots/:id/readiness`, `/host/spots/:id/ownership-document` | Host | What is still missing; the host's own document |
| POST | `/host/spots/:id/submit` | Host | → `PENDING_REVIEW`, never straight to live |
| GET | `/host/summary`, `/host/earnings`, `/host/bookings` | Host | Running a space day to day; every one scoped to the caller's host profile |
| GET / PATCH / POST / DELETE | `/host/spots/:id/overview`, `/pause`, `/calendar`, `/blocks`, `/blocks/:blockId` | Host | One listing's dashboard, pausing new bookings, and hours taken off sale |
| GET / POST | `/host/payout-account` | JWT | PAN + bank details → Cashfree Easy Split vendor; read back masked |
| GET/POST/PATCH/DELETE | `/host/availability` | Host | One window at a time |
| GET / POST | `/admin/spots`, `/admin/spots/:id`, `…/approve`, `…/reject`, `…/suspend`, `…/ownership-document` | Admin | Listing review |
| GET / POST | `/admin/problems`, `/admin/problems/:id/resolve` | Admin | Problem reports; upholding one refunds the driver |
| GET / POST | `/admin/refunds`, `/admin/refunds/:id/retry` | Admin | Refunds with their gateway ids; retry a `FAILED` one (3 attempts in all) |
| POST | `/admin/host-payout-status` | Admin | Set a host's payout status by hand |

There is no admin screen in the app: the admin routes are called directly.

### Booking correctness

- **Double booking.** What is competed for is a range of time, not a count,
  so the guard is the `Booking_no_overlap` EXCLUDE constraint over the listing
  and the stay, covering `PENDING` and `CONFIRMED`. A host's `ListingBlock` is
  not a booking and the constraint cannot see it, so bookings, extensions and
  blocks also check each other inside a per-listing advisory lock
  (`lib/listing-lock`).
- **Unpaid holds expire.** A `PENDING` booking holds its hours for 15 minutes
  (`holdExpiresAt`). Lapsed holds are swept on the next attempt against that
  listing rather than on a schedule: the only moment an expired hold matters
  is when somebody else wants those hours. Search already ignores them.
- **Idempotency.** A repeated `idempotencyKey` returns the original booking
  instead of making a second; the racing case is covered by catching the
  unique violation. A key belonging to *another* user answers `409` rather
  than handing over their booking.
- **Server-derived fields.** `driverId` comes from the JWT and `amount` from
  the spot's own rates. Neither is accepted from the request body.

### Money

One source of revenue: a service fee taken from the host's side
(`COMMISSION_RATE`, in `config/pricing.ts`). The driver pays the listed price
with nothing on top.

- **In.** `POST /spot-bookings` writes the `Payment` row inside the hold's
  transaction and opens the Cashfree order after it, with the host's share as
  an Easy Split `order_splits` entry. A listing is only bookable while its
  host's vendor is `ACTIVATED`, and a driver without a phone number is
  refused before any hold (`409 PHONE_REQUIRED`).
- **Confirmed by Cashfree only.** A booking becomes `CONFIRMED` when Get
  Payments says the order is paid, asked after a payment webhook or on the
  driver's booking read. The app never states that it paid, or a price.
- **Late money.** A payment that lands after the hold lapsed confirms the
  booking if the hours are still free; otherwise, and for a payment after a
  cancel or after the stay, it is refunded in full.
- **Back.** Driver cancellation: everything back until 60 minutes before the
  start, then 50% of the parking until the start, nothing after. Every
  `Refund` row is sent to Cashfree after its transaction commits, with the
  host's part as `refund_splits`; status comes from the refund webhook and
  Get Refund, with a job as the fallback.
- **To the host.** Cashfree settles the host's share to their bank itself;
  GatePass never moves host money. `HostPayout` rows come from the settlement
  webhook and feed the earnings and Payouts screens.

Verified in the Cashfree sandbox on 2026-10-03, from the phone: hold → UPI
payment → payment webhook → `CONFIRMED` → cancel (`LATE`, ₹9.38 of ₹18.75) →
Create Refund → `REFUNDED`.

### No gate pass in v1

Removed on 2026-10-01 (owner's decision): `Booking.qrToken`, `pass.service`,
`GET /bookings/:id/pass`, the app's pass screen and `react-native-qrcode-svg`.
Nothing ever scanned a pass, and most spots are gate-code, intercom or open
access, where nobody would. A confirmed booking releases the address, access
instructions and bay; the host's booking list shows the driver's first name
and plate to check at the gate; "I can't use this parking" covers a driver
turned away. If check-in comes back (society guards), the plan discussed was
a pass valid for the whole stay (saved for basements with no signal), a
six-digit fallback code, and a host scan screen -- never built; the old
five-minute pass is in git history before this change.

---

## 9. What is not built yet

Auth, search, booking, payment, refunds, extra time, the host wizard, host
payouts and push notifications are built. What remains:

- **Cashfree is sandbox only.** `CASHFREE_ENV=sandbox`; card payment exists
  only for sandbox testing and UPI is the one production method planned so
  far. Production keys and go-live are not done.
- **Webhooks need a fixed public URL.** In development `WEBHOOK_PUBLIC_URL` is
  a Cloudflare quick tunnel (`npm run tunnel -w be`) whose address changes on
  every start. Payment webhooks follow each order's `notify_url`, so they
  move with `.env`; the refund and Easy Split webhooks are endpoints set in
  the Cashfree dashboard and have to be edited there each time. Production
  needs one HTTPS address.
- **The refund failure path has only met a fake Cashfree.** A `FAILED` refund
  and the admin retry are covered by `npm run test:refunds`, not yet by the
  sandbox.
- **Host cancellation.** Only the driver can cancel a booking. A host can
  pause a listing or block hours, but has no way to give a booked stay back;
  the design was deferred (owner's decision).
- **No admin screen.** Listing review, problem reports, refund retries and the
  payout-status override are API routes only (section 8).
- **Host verification is part manual.** A spot goes live only when both gates
  clear — an admin accepting the ownership document (`docApprovedAt`) and the
  payout account reaching `ACTIVATED` at Cashfree — in whichever order they
  arrive. The payout side is Cashfree's own check, kept current by the
  vendor-status webhook and Get Vendor. `HostProfile.verificationStatus`
  still starts at `ACTIVE` with nothing checking it.
- **GST is not charged.** `GST_ENABLED` / `GST_RATE` exist in `.env` and
  `config/pricing.ts`, and nothing computes tax yet. It would fall on
  GatePass's service fee, not on the parking.
- **Geo at scale.** Radius search is a bounding-box prefilter on a plain
  B-tree plus haversine in SQL. Honest to a few thousand listings; PostGIS or
  `earthdistance` is the answer if it becomes the hot path.
- **Timezone.** Host availability windows and stay times are interpreted as
  `Asia/Kolkata`, hard-coded in `lib/venue-time.ts`. Correct for a
  single-market product and wrong the day it crosses a timezone.
- **Native readiness.** The app runs on Android as a development build over
  USB (`expo run:android`, package `com.gatepass.app`, a real adaptive icon,
  the `expo-location` plugin declared). Still open:
  - `EXPO_PUBLIC_API_URL` defaults to `http://localhost:3000`, which on a phone
    is the phone. Development uses `adb reverse tcp:3000 tcp:3000` with
    `http://127.0.0.1:3000`; production needs HTTPS -- iOS ATS and Android
    (API 28+) block cleartext anyway.
  - Only the web Google client id is set; Android and iOS need their own
    (`EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` / `_IOS_`).
  - No release build, and nothing has been run on iOS (no bundle id in
    `app.json`).
- **Booking lifecycle (built).** Bookings list as Upcoming / Active / Past,
  each carrying a derived `phase`. ACTIVE is never stored — the overlap
  EXCLUDE covers PENDING and CONFIRMED only, so a stored ACTIVE would let a
  parked car's remaining hours be resold. `COMPLETED` is written lazily when a
  driver's list is read. Cancellation quotes and applies one policy
  (`be/src/config/pricing.ts`); refunds are their own table. Extra time is a
  PENDING child booking (`extendsBookingId`) so it is held while being paid
  for. Design: `specs/driver-journey_design.md`. Since 2026-10-01 it is paid
  exactly like a booking -- its own Payment row and Cashfree order with the
  host's split, paid on the same pay screen by its own id, confirmed or
  refunded by the same code; confirming it reopens a stay the sweep had
  already closed. Options stay 30 min / 1 hr / 2 hr. Design:
  `specs/extension-payments_design.md`.
- **Payments and refunds (built)** go through Cashfree (`PAYMENT_PROVIDER=cashfree`,
  `specs/cashfree-payments_design.md`). Every `Refund` row -- driver cancel
  (FULL / LATE), late payments (HOLD_LAPSED, CANCELLED_BEFORE_PAYMENT,
  PAID_AFTER_STAY), an upheld problem report -- is sent after its transaction
  commits, retried by a 60 s job (5 sends max), reconciled by Get Refund and
  `REFUND_STATUS_WEBHOOK`; partial refunds are split 90/10 with
  `refund_splits`; failed ones wait for `POST /admin/refunds/:id/retry`
  (3 attempts). Design: `specs/cashfree-refunds_design.md`.
- **Migrations are dev-shaped.** One `CREATE` per table, edited in place as
  the schema changes. Before the first production deploy they become the
  baseline, and every later change is a new additive migration.
- **Dead columns.** `User.gstNumber` and `User.bankAccountId` are no longer
  read or written anywhere: `HostProfile` carries the payout account now.
  They are still in the schema and should be dropped.
- **Phone is unverified.** `PATCH /auth/me` stores a normalised `+91` number,
  but nothing proves the user holds it. Paying already requires one
  (`409 PHONE_REQUIRED`) and it is sent to Cashfree as the customer's phone,
  so a mistyped number goes through unnoticed. There is no SMS provider.
- **`profileComplete` is thin.** It means `firstName !== null` and nothing
  more. "Can this user actually book" (name + phone + a vehicle) is a
  different question and is not modelled.
- **Personal-data erasure.** Account deletion is soft (section 3); the purge
  job a DPDP erasure request would need does not exist.

`JWT_SECRET` no longer accepts the `.env.example` placeholder -- the server
refuses to start on a known stand-in value, because a published secret signs
valid tokens for every user. Generate one with `openssl rand -base64 48`.

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

App, on an Android phone over USB (the development build must already be
installed; `expo run:android` builds and installs it, and is only needed
again after a native dependency changes):

```bash
adb reverse tcp:3000 tcp:3000
```

```bash
adb reverse tcp:8081 tcp:8081
```

```bash
cd fe && npx expo start --dev-client --localhost
```

The two `adb reverse` forwards are lost on every replug. `fe/.env` points the
app at `http://127.0.0.1:3000`, which through the forward is this machine's
API.

Cashfree webhooks, in development:

```bash
npm run tunnel -w be
```

Put the address it prints in `WEBHOOK_PUBLIC_URL` (`be/.env`), restart the
API, and set `<address>/webhooks/cashfree` as the webhook endpoint in the
Cashfree dashboard (sandbox). The address changes every time the tunnel
starts. Without it payments and refunds are still confirmed, by asking
Cashfree when the driver's booking is read and from the refund job.

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
the API from source with `npm run dev` instead.

This has caused real failures three times: `POST /auth/google`, then
`GET /bookings/active`, then `GET /vehicles` and
`GET /address` — each one a new route answering `404 Route not found` while
every older route worked, which looks exactly like a frontend bug. Whenever
`be/` changes and the container is in use, rebuild it:

```bash
docker compose up -d --build be
```

**`GET /health` now says whether the running code is current**, so this is one
call to check rather than an afternoon:

```json
{ "status": "ok", "build": "2026-09-19T12:04:11Z", "routes": 31, … }
```

`build` is stamped into the image at build time (`source` when running from
`npm run dev`), and `routes` is counted from Fastify's own route table once
the server is listening. A container started without `--build` reports an
older stamp and a lower count. The same line is printed at startup, so
`docker compose logs be` shows it too.

The tell from the other side is the 404 body itself: Fastify answers an
unregistered route with `{"message":"Route GET:/address not found",…}`, so a
`Content-Length` of exactly 79 on `/address` means the route does not exist on
that server — not that the handler failed.

### Environment

`be/.env.example` and `fe/.env.example` are the templates.

Backend: `DATABASE_URL` and `JWT_SECRET` (16+ chars) are required;
`JWT_EXPIRES_IN` must look like `30d`/`12h`/`15m`/`60s` and is checked at
startup. `EMAIL_PROVIDER=resend` additionally requires `RESEND_API_KEY`.

Payments: `PAYMENT_PROVIDER=cashfree` with `CASHFREE_ENV` (`sandbox`),
`CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET` and `CASHFREE_API_VERSION`;
`WEBHOOK_PUBLIC_URL` is where Cashfree can reach this API;
`COMMISSION_RATE` is GatePass's service fee; `GST_ENABLED` / `GST_RATE` are
read and not yet applied. Push: `PUSH_PROVIDER` (`console` or `fcm`), with
`FIREBASE_SERVICE_ACCOUNT_FILE` pointing at the key in `be/secrets/` for
`fcm`. Secrets live only in `be/.env` and `be/secrets/`, both gitignored.

Google sign-in needs an OAuth client from Google Cloud Console, with the same
id in both places — the app mints tokens with it, the API checks them against
it:

| File | Variable |
|---|---|
| `be/.env` | `GOOGLE_CLIENT_IDS` — comma-separated web, iOS, Android ids |
| `fe/.env` | `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (plus `_IOS_` / `_ANDROID_` later) |

Leave both empty and Google is off: the endpoint returns 503, and the button is
hidden in production or shown disabled with a hint in development. Expo reads
`EXPO_PUBLIC_*` at bundle time, so restart it with `--clear` after changing
them.

**Current local state:** a Web client id exists (Google Cloud project
`GatePass`) and is set in both files. Creating one:

1. Google Cloud Console → new project.
2. **Google Auth Platform** (formerly *OAuth consent screen*): External
   audience, app name and support email. Add your own Gmail under **Test
   users** — while the app is in Testing mode, only listed accounts can sign
   in. No extra scopes; `openid email profile` are the defaults.
3. **Clients** (formerly *Credentials*) → **Web application**. Authorized
   JavaScript origin `http://localhost:8081`; redirect URIs
   `http://localhost:8081` and `http://localhost:8081/`. If Google reports
   `redirect_uri_mismatch`, its error page shows the exact URI to add.
4. Copy the **Client ID** into both env files. The **client secret is not
   used** by this flow and must never go in `fe/.env` — every `EXPO_PUBLIC_*`
   value ships inside the app bundle. The client id is public by design.

iOS and Android clients are still to be created (iOS needs a bundle id, not
yet set in `app.json`; Android needs the package name, `com.gatepass.app`,
and the build's signing SHA-1).
All ids then go comma-separated into `GOOGLE_CLIENT_IDS`, because on native the
token's `aud` is that platform's id.

`EMAIL_PROVIDER` is still `console`, so no real mail is sent even though a
Resend key is present locally. Switching to `resend` sends real mail, but
until a sending domain is owned and verified, Resend only delivers to the
account's own address. `EMAIL_FROM` defaults to `no-reply@gatepass.app`.
