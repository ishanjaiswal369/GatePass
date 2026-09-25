# GatePass — Implementation Notes

Last updated: 2026-09-22

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
      geocode/          Ola + Google providers, off by default
      google/verify.ts  Google ID token verification
      http.ts           axios + retry
    middleware/         authenticate, requireHost, requireOrganizerStaff, requireAdmin
    lib/                app, errors, prisma, request wrapper, pagination
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
  one number. Only mobile prefixes (6-9) are accepted — OTP, Razorpay contact
  and gate calls all assume a mobile. **The number is stored unverified**;
  there is no phone OTP yet.
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
(`PENDING`/`CONFIRMED`) booking as a driver, upcoming bookings at the user's
spot, an unfinished payout (`PENDING`/`PROCESSING`/`DISPUTED`), or an
organizer membership. Each is a person who would be left stranded.

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
  app/                  routes only: index, verify, profile, home, bookings,
                        host, password, account (+ details, vehicles,
                        address), event/[id], pass/[id]
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
- A raw hex or `fetch` call in a screen is a bug.
- Every pressable clears 44px.

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

`app/home.tsx` is the screen the canvas designs, built against the live API and
driven end to end in a browser (sign in → Events → Nearby → pass).

- **Two tabs, Events first.** Events has real organizer listings; Nearby has
  almost no hosts yet, so it cannot be the landing tab.
- **Location is asked on the Nearby tab, on a button press** -- never on app
  open. `useDriverLocation` runs nothing on mount. A cold permission prompt
  with no visible reason gets denied, and a denial is far harder to undo than
  a delay. A refusal falls back to typing an area, which resolves through
  `GET /geocode`.
- **The pass card sits above discovery**, because a driver mid-booking needs
  the QR before anything else here. `GET /bookings/active` answers 200 with
  `booking: null`, so "no pass" is a layout state rather than an error.
- **Three parallel calls, no aggregate endpoint.** The feed is shared and
  cacheable, the pass is per-user and must be fresh. A failing pass call stays
  silent instead of blanking the feed.
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
    user can be a driver and a host at once. It becomes true when the Host
    onboarding form is submitted, which creates the profile and the
    published spot in one transaction, and never goes back to false.
  - A stale flag (the user became a host on another device) makes onboarding
    return 409; the app treats that as "already a host", flips the flag and
    loads the dashboard rather than showing an error.
- `app/pass/[id].tsx` re-mints the five-minute pass on a timer, so the code on
  screen is never the one that just expired.

Screens reached from the home screen but **not** in the canvas --
`bookings`, `host`, `event/[id]` -- are built plainly from the same tokens so
the nav has no dead ends. `event/[id]` is read-only: checkout is its own
designed flow and needs Razorpay.

### The host listing wizard

Nine steps under `app/host/spot/`, in the order `constants/wizard.ts` lists
them: **type, address, photos, availability, pricing, access, documents,
payout, review**. Each step is its own URL and its own request against the
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
- **Payout details are kept.** `submit` used to validate a PAN, an account
  holder, an account number and an IFSC, store only the PAN and park the host
  at `UNDER_REVIEW` — a review with nothing to review, and a status that could
  never honestly move. They are stored now and read back masked (`ABCDE****F`,
  `•••• 9012`). When a gateway lands, `host-payout.service` is the only file
  that changes.
  - Hosts who submitted under the old code have a status but no details, so
    `needsDetails` answers "must this host still enter them?" separately from
    the status. Without it they would be locked out of the one screen that
    fixes it, permanently.
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
  *"Attempted to navigate before mounting the Root Layout component"*. Because
  the session token is held in memory only, every page reload on a protected
  route hits exactly that path. A redirect element is rendered rather than
  run, so it cannot fire early. Navigating from a press handler is fine --
  those happen long after the navigator is ready.

### Splash

`assets/splash.png` (1284×2778) is the opening brand image: the barrier mark
and wordmark on the app's ink, above a row of nine painted parking bays with
one (06) held brighter. Design rationale: `design/splash-philosophy.md`.

The one image is used twice:

- **Native splash** in `app.json`, on `#111827` so other aspect ratios
  letterbox seamlessly.
- **`BrandSplash`**, an overlay in the root layout that holds it ~2.2 s on
  cold start and fades out over the first screen, sharing `PhoneFrame`'s
  footprint so the reveal lands in place. On a device the hand-off from the OS
  splash is invisible; on web, which has no native splash, it is the only
  place the splash appears. It lives in root state, so navigation never brings
  it back.

The session token is held in memory only — a reload signs you out. Persisting
it needs `expo-secure-store` on native and is a separate decision.

---

## 5. Data model

| Table | Purpose |
|---|---|
| `User` | `email` unique + required, `googleId` unique + nullable, `phone` optional (E.164 `+91…`), `passwordHash`/`passwordSetAt` nullable, `firstName`/`lastName` nullable, `role`, `deletedAt` nullable (soft delete) |
| `EmailVerification` | 6-digit `code`, 5-minute expiry, `verified`, `attempts`, `purpose`, pending `firstName`/`lastName`; indexed on `(email, purpose, createdAt)` for rate limiting |
| `Vehicle` | saved number plate + type per user, one `isDefault`; unique on `(userId, vehicleNumber)` |
| `UserAddress` | the driver's own address, 1:1 with `User`; `country` fixed to India |
| `UserSession` | per-device session, `deviceId`, `fcmToken` (reserved), `lastActiveAt`, `expiresAt` |
| `Listing` | an organizer's event **or** a host's spot; exactly one of `organizerId`/`hostProfileId` is set (DB `CHECK`) |
| `HostProfile` | 1:1 optional on `User`. Its existence *is* the answer to "is this user a host" -- never `role`. Holds no address (0024); holds the payout details until a gateway does |
| `HostAvailability` | weekly windows for one spot: `dayOfWeek`, minute range, `isActive` toggle. Scoped to the `Listing`, not the host, with a DB `EXCLUDE` against overlaps. Price is **not** here -- see `SpotPricing` |
| `SpotPhoto` / `SpotPricing` | a spot's photos in display order, and one rate per vehicle type for the whole spot |
| `Organizer` / `OrganizerMember` | the business entity and its staff logins; listings and settlements hang off the entity |
| `ParkingCapacity` | per `(listing, vehicleType)`: `totalCapacity`, `bookedCount`, `price` |
| `Booking` | `quantity`, `amount` snapshot, `status`, `idempotencyKey` unique, `qrToken` unique |
| `Payment` | separate from `Booking` because payment state and booking state are different machines; Razorpay ids |
| `Settlement` / `SettlementItem` | per-period payout with a per-booking breakdown; paid to an organizer **or** a host (DB `CHECK`) |

`createdBy`/`updatedBy` columns exist on `Listing`, `Booking`, `Payment` and
`Settlement`. Listing, booking, payment and settlement creation populate them.

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
unrecognised value. `Booking.status`, `Payment.status` and
`Settlement.status` feed the settlement maths, so a bad value there is a money
bug, not a display bug. Writes to those columns must keep going through the
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
| `0006_create_notification_preference` | `NotificationPreference` |
| `0007_create_notification` | `Notification` |
| `0008_create_organizer` | `Organizer` |
| `0009_create_organizer_member` | `OrganizerMember` |
| `0010_create_host_profile` | `HostProfile` |
| `0011_create_listing` | `Listing` + `Listing_one_owner` CHECK |
| `0012_create_host_availability` | `HostAvailability` + day/minute range CHECKs, `btree_gist`, `HostAvailability_no_overlap` EXCLUDE |
| `0013_create_parking_capacity` | `ParkingCapacity` |
| `0014_create_spot_pricing` | `SpotPricing` |
| `0015_create_spot_photo` | `SpotPhoto` |
| `0016_create_favorite` | `Favorite` |
| `0017_create_listing_block` | `ListingBlock` |
| `0018_create_booking` | `Booking` + `Booking_one_target` CHECK, `Booking_no_overlap` EXCLUDE |
| `0019_create_payment` | `Payment` |
| `0020_create_refund` | `Refund` |
| `0021_create_problem_report` | `ProblemReport` |
| `0022_create_review` | `Review` |
| `0023_create_settlement` | `Settlement` + `Settlement_one_payee` CHECK |
| `0024_create_settlement_item` | `SettlementItem` |

`npx prisma migrate deploy --schema prisma/schema` builds a fresh database;
`migrate diff --from-migrations … --to-schema-datamodel …` must report no
difference. A schema change during development edits the table's `.prisma`
file and its `create_*` migration together (see the README). That stops
working at the first production deploy: from then on, changes are new
additive migrations.

---

## 8. API surface

Everything except `/health` and `/auth/*` sign-in requires a JWT. There is no
open group left.

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
| GET | `/events` | JWT | Working; the Events tab feed |
| GET | `/events/:id` | JWT | Working |
| GET | `/spots/nearby` | JWT | Working; the Nearby tab |
| GET | `/geocode` | JWT | Working when a provider is configured, else 503 |
| GET | `/bookings` | JWT | Working; driver-scoped, cursor paginated |
| GET | `/bookings/active` | JWT | Working; the home screen's pass card |
| GET | `/bookings/:id` | JWT | Working |
| GET | `/bookings/:id/pass` | JWT | Working; mints a 5-minute pass |
| POST | `/bookings` | JWT | Working; atomic and idempotent |
| GET / POST | `/payments` | JWT | Stub, but scoped and server-priced |
| GET | `/host/profile` | JWT | Working; `profile: null` for a non-host |
| GET | `/host/spots` | Host | Working; every spot with its hours, plus the payout gate — the whole dashboard in one call |
| POST | `/host/spots` | JWT | Working; opens a **named** listing, and makes the caller a host if they were not one |
| GET / DELETE | `/host/spots/:id` | Host | Working; delete is a soft cancel |
| PATCH | `/host/spots/:id/{type,address,photos,ownership-document,terms,pricing}` | Host | Working; one wizard step each |
| PUT | `/host/spots/:id/availability` | Host | Working; replaces the week |
| POST | `/host/spots/:id/{photo,document}-upload-url` | Host | Working; presigned, bytes never touch the API |
| GET | `/host/spots/:id/readiness` | Host | Working; what is still missing |
| POST | `/host/spots/:id/submit` | Host | Working; → `PENDING_REVIEW`, never straight to live |
| GET / POST | `/host/payout-account` | Host | Working; PAN + bank details, read back masked |
| GET/POST/PATCH/DELETE | `/host/availability` | Host | Working; one window at a time |
| GET | `/host/settlements` | Host | Working (engine not built) |
| GET / POST | `/listings` | Organizer | Working; scoped to the caller's organizers |
| GET / POST | `/capacities` | Organizer | Working; scoped |
| GET | `/settlements` | Organizer | Working (engine not built) |
| POST | `/settlements`, `/settlement-items` | Admin | Stub; the payout engine will own these |

`GET /users`, `POST /users` and `GET /users/:id` **were removed.** They had no
auth and returned whole `User` rows, so anyone who could reach the API could
dump every user's email and phone number. `/auth/me` covers what the app
needed from them.

### The driver home screen

Three parallel calls, deliberately not one aggregate endpoint: the feed is
shared and cacheable, the pass is per-user and must be fresh, and one endpoint
would force the strictest policy of the three onto all of them.

| Call | Fills |
|---|---|
| `GET /auth/me` | avatar initial, and `hasHostProfile` (also on every sign-in response); also vehicles and address for the profile hub |
| `GET /bookings/active` | the ACTIVE PASS card (200 with `booking: null` when there is none) |
| `GET /events?limit=…` | the UPCOMING NEAR YOU list |

`GET /events` takes `q`, `latitude`+`longitude`, `radiusKm`, `from`, `to`,
`cursor` and `limit`. `minPrice`, `spotsLeft` and `vehicleTypes` are computed
in one SQL statement with a join and `GROUP BY`, not by loading capacity rows
into Node. Only `PUBLISHED`/`ONGOING` listings with an `eventDate` appear --
the card renders a day and a month, so an undated listing has nothing to show,
and `DRAFT` must never leak.

### Booking correctness

The three bugs that section 9 used to describe are fixed and verified against
a live Postgres:

- **Oversell.** The capacity claim is a single conditional `UPDATE` --
  `SET bookedCount = bookedCount + n WHERE id = ? AND bookedCount + n <=
  totalCapacity` -- so the check and the increment cannot be split by a
  concurrent request. Verified: 8 simultaneous bookings against a capacity of
  2 produced exactly 2 bookings and `bookedCount = 2`.
- **Idempotency.** A repeated `idempotencyKey` returns the original booking
  with `200` instead of `201`, and does not increment capacity twice. The
  racing case is covered by catching the unique violation: the loser's whole
  transaction rolls back, its capacity increment included. A key belonging to
  *another* user answers `409` rather than handing over their booking.
- **Server-derived fields.** `driverId` comes from the JWT, `amount` from
  `ParkingCapacity.price`, and `qrToken` from `randomBytes(32)`. None of the
  three is accepted from the request body any more.

### Passes

`qrToken` is the durable secret and never appears in any response. Displaying
a pass calls `GET /bookings/:id/pass`, which returns a JWT with `typ:
"gate-pass"`, the booking id and a hash of `qrToken`, valid for five minutes.
A screenshot is therefore worthless within minutes, and rotating `qrToken`
invalidates every pass already issued. **The gate scanner that verifies these
is not built** -- `pass.service.verify` exists for it.

---

## 9. What is not built yet

Auth, discovery and booking correctness are done. What remains:

**The gap that matters most: unpaid holds on an *event* are never released.**
A booking is created `PENDING` and has already claimed its capacity. If the
driver never pays, that slot stays claimed forever -- an event can show "sold
out" with nobody actually coming. **Do not run a real event sale before this
exists.**

Host spots no longer have this problem: 0025 gave `Booking` a `holdExpiresAt`,
and `releaseExpiredHolds` cancels lapsed `PENDING` rows on the next attempt
against that listing -- swept on demand rather than on a schedule, because the
only moment an expired hold matters is when somebody else wants those hours.
The event path needs the same treatment, and it has to land with payments,
because the two are one problem seen from two sides.

Also missing:

- **Razorpay.** `POST /payments` opens a row with the booking's own amount and
  a fixed `CREATED` status, which is as far as a stub can honestly go. No
  order creation, no webhook, no capture -- so nothing ever reaches
  `CONFIRMED` on its own, and the pass card stays empty in a real flow.
- **The gate scanner.** Passes are minted but nothing verifies them yet.
- **Settlement calculation.** Commission and payout maths are not written.
  Hosts are paid through the same periodic engine as organizers in v1; instant
  payout (Razorpay Route) is a deliberate omission -- it needs a linked
  account and KYC that self-serve onboarding does not collect.
- **Host verification is manual, and half of it has no operator.** A spot goes
  live only when both gates clear — an admin accepting the ownership document
  (`docApprovedAt`) and the payout account reaching `ACTIVATED` — and
  `publishIfReady` handles them arriving in either order. But `HostProfile`
  starts at `verificationStatus: ACTIVE` with nothing checking it, the PAN and
  bank details are format-checked only, and there is no gateway and no admin
  UI, so `UNDER_REVIEW` currently moves only by hand in SQL. Storing the
  details (0024) is what makes that possible at all; automating it is the
  gateway integration.
- **Booking a host spot.** `/spots/nearby` finds them, but the booking flow is
  per-slot against `ParkingCapacity`, and a host spot is priced per hour
  against a `HostAvailability` window. `POST /bookings` refuses an
  `INDEPENDENT_SPOT` with a 400 rather than charging the wrong amount.
- **Search quality.** `GET /events?q=` is `ILIKE '%…%'`, which cannot use an
  index. Fine at this catalogue size; a `pg_trgm` GIN index is the next step
  and was left out because `CREATE EXTENSION` needs rights a managed Postgres
  may not grant.
- **Geo at scale.** Radius search is a bounding-box prefilter on a plain
  B-tree plus haversine in SQL. Honest to a few thousand listings; PostGIS or
  `earthdistance` is the answer if it becomes the hot path.
- **Timezone.** Host availability windows are interpreted as `Asia/Kolkata`,
  hard-coded in `spot.service.ts`. Correct for a single-market product and
  wrong the day it crosses a timezone.
- **Native readiness.** The app is React Native, so the same code builds for
  iOS and Android, and `PhoneFrame`, the safe areas and every stored value
  already branch per platform. Four things still assume a browser or are
  unconfigured, and all four bite only on a real device:
  - `EXPO_PUBLIC_API_URL` defaults to `http://localhost:3000`, which on a phone
    is the phone. A LAN address is needed in development and HTTPS in
    production -- iOS ATS and Android (API 28+) block cleartext anyway.
  - `app.json` does not declare the `expo-location` plugin, so iOS has no
    `NSLocationWhenInUseUsageDescription`. Requesting location without it
    crashes on device and fails App Store review.
  - Only the web Google client id is wired; iOS and Android need their own,
    plus a dev build (Expo Go will not do native Google sign-in here).
  - The Android adaptive icon sets `backgroundColor` but no `foregroundImage`.
- **Event checkout.** `event/[id]` lists prices and availability but cannot
  book: that is the `design/Booking` flow and it needs Razorpay. A host spot
  *can* be booked -- `spots/[id]` carries the search hours into
  `spots/checkout`, which picks a saved vehicle, prices the stay and calls
  `POST /spot-bookings` -- but it stops at a `PENDING` hold, and the screen
  says so rather than implying a pass.
- **Booking lifecycle (built).** Bookings list as Upcoming / Active / Past,
  each carrying a derived `phase`. ACTIVE is never stored — the overlap
  EXCLUDE covers PENDING and CONFIRMED only, so a stored ACTIVE would let a
  parked car's remaining hours be resold. `COMPLETED` is written lazily when a
  driver's list is read. Cancellation quotes and applies one policy
  (`be/src/config/pricing.ts`); refunds are their own table. Extra time is a
  PENDING child booking (`extendsBookingId`) so it is held while being paid
  for. Design: `specs/driver-journey_design.md`.
- **`/spots/nearby` does not subtract existing bookings.** It matches a search
  against the host's *availability* only, so a spot whose hours are already
  taken still comes back as a result. The driver finds out at checkout, from
  the 409 the `EXCLUDE` constraint produces. Honest, but late:
  `booking.service.bookedRanges` exists to fix this and has no route yet.
- **Payments are not wired.** The app's pay UI goes through one seam,
  `fe/src/lib/payments.ts`, which answers NOT_CONFIGURED until Cashfree is
  connected there and on the API. A booking becomes CONFIRMED from the
  gateway's webhook on the API, never from the app. Until then every booking
  stops at a PENDING hold; later states are tested by setting data directly.
- **Migrations are dev-shaped.** One `CREATE` per table, edited in place as
  the schema changes. Before the first production deploy they become the
  baseline, and every later change is a new additive migration.
- **Dead columns.** `User.gstNumber` and `User.bankAccountId` are no longer
  read or written anywhere: `Organizer` and `HostProfile` carry those now.
  They are still in the schema and should be dropped.
- **Event bookings do not use saved vehicles yet.** `spots/checkout` picks one
  and sends its type, so the spot path reads the rate off it. `POST /bookings`
  still takes `vehicleNumber` as free text; wiring event checkout the same way
  — and preselecting the `ParkingCapacity` matching the vehicle's type — is
  the next step.
- **Phone is unverified.** `PATCH /auth/me` stores a normalised `+91` number,
  but nothing proves the user holds it. Razorpay and gate contact both assume
  it is real, so an SMS OTP is needed before either depends on it.
- **`profileComplete` is thin.** It means `firstName !== null` and nothing
  more. "Can this user actually book" (name + phone + a vehicle) is a
  different question and is not modelled.
- Organizer dashboard, push notifications (the `fcmToken` column is reserved
  but unused), recurring/commercial listing types.

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
`GET /events` and `GET /bookings/active`, then `GET /vehicles` and
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

iOS and Android clients come later with a dev build (iOS needs a bundle id,
not yet set in `app.json`; Android needs the package name and signing SHA-1).
All ids then go comma-separated into `GOOGLE_CLIENT_IDS`, because on native the
token's `aud` is that platform's id.

`EMAIL_PROVIDER` is still `console`, so no real mail is sent even though a
Resend key is present locally. Switching to `resend` sends real mail, but
until a sending domain is owned and verified, Resend only delivers to the
account's own address. `EMAIL_FROM` defaults to `no-reply@gatepass.app`.
