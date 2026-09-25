# Driver & host journey — technical design

Implements the approved clickable prototype (claude.ai artifact *GatePass App
Prototype*) in the Expo app (`fe/`) and the Fastify + Prisma API (`be/`),
phase by phase. Each phase ships on its own: typechecked, verified against the
live dev database, committed.

## Ground rules

- **Structure stays as it is.** API: route in `src/api.ts` → zod schemas in
  `src/requests/*.request.ts` → thin handler in `src/controllers` → logic in
  `src/services`. Enums are TEXT + zod in `src/constants/enums/` mirrored in
  `fe/src/constants/enums.ts`. App: routes only under `fe/app/`, everything
  else under `fe/src/` (`api/`, `components/ui/`, `features/`, `lib/`, `hooks/`).
- **No new migration files in development.** Schema changes are made in
  `be/prisma/schema/*.prisma` and applied with `npm run db:push`. Before any
  production deploy a baseline migration has to be generated from the schema.
  - `db push` drops whatever the schema does not declare. Twenty indexes and
    the `ON DELETE RESTRICT` rule of six foreign keys existed only in migration
    SQL; Phase 0 declares them, so a push against an unchanged schema is a
    no-op.
  - The raw-SQL `Booking_one_target` CHECK and `Booking_no_overlap` EXCLUDE
    are invisible to Prisma and survive every push. They **cannot be changed**
    without a migration, so the design works inside them (below).
- **Payments are front-end only.** The owner wires Cashfree. The app gets a
  complete pay UI behind one seam, `fe/src/lib/payments.ts`; until it is wired
  a booking stays a `PENDING` hold and the UI says so.
- **Fees and policy are config**, `be/src/config/pricing.ts`, mirrored to the
  app through the API rather than duplicated: driver platform fee ₹20 + 18% GST
  on the fee; host commission 10%; free cancellation until 1 h before start,
  50% of the parking amount until start, nothing after.

## Cross-cutting: rate limiting and security logging

Added before Phase 4, because the fullstack-guardian checklist asks for both on
every feature and the API had neither.

- **Rate limiting** (`lib/rate-limit.ts`, `@fastify/rate-limit`, in memory).
  Three buckets per minute: `auth` — the unauthenticated sign-in and password
  routes — 10 per IP; `write` — any non-GET — 60 per user; `read` — 300 per
  user. The caller is the user id from a token whose signature verifies (no
  DB hit), else the IP, so junk tokens don't buy fresh buckets. `/health` and
  signed upload URLs are exempt. All numbers are env (`RATE_LIMIT_*`). One API
  process only: several need a shared store (Redis) — flagged for production.
  `TRUST_PROXY` must be on behind a proxy, and off otherwise, or
  `X-Forwarded-For` picks the IP.
- **Logging** (`lib/security-log.ts`, Fastify's pino, JSON). `security` events
  at warn: `AUTH_FAILED`, `ACCESS_DENIED`, `NOT_FOUND` (signed-in caller,
  missing or not theirs), `RATE_LIMITED`, `VALIDATION_FAILED` (field names
  only). `audit` events at info for state that money or trust depends on:
  bookings held and cancelled, extensions, reviews, and each later phase's
  writes. Ids only — never tokens, codes, emails or free text; the
  Authorization header is redacted. Access lines are off.

## Booking state model

Three independent state machines, as spec rule 13 requires.

| Entity | Stored states | Notes |
|---|---|---|
| `Booking.status` | `PENDING` → `CONFIRMED` → `COMPLETED`; `CANCELLED` | as today |
| `Refund.status` | `REFUND_PENDING` → `REFUNDED` (`FAILED`) | new table, one per booking |
| `ProblemReport.status` | `OPEN` → `RESOLVED` | new table (Phase 4); a booking with an open report reads as *disputed* |

**ACTIVE is derived, never stored.** `Booking_no_overlap` only covers
`PENDING` and `CONFIRMED`. A stored `ACTIVE` status would drop a parked car's
booking out of the overlap guard, and the rest of its hours could be sold
twice. So a `CONFIRMED` booking whose time has started *is* active, and the API
returns a derived `phase` alongside `status`:

```
phase = PENDING | EXPIRED | UPCOMING | ACTIVE | COMPLETED | CANCELLED
```

`COMPLETED` is written lazily: listing a driver's bookings first flips their
`CONFIRMED` bookings whose `endsAt` has passed. A finished stay leaving the
overlap guard is correct, since its time is in the past. The same sweep pattern
already releases expired holds, so no scheduler is added.

**Extension is a child booking.** An extension is a new `PENDING` booking for
`[oldEnd, newEnd)` on the same listing, linked by `extendsBookingId`. The
overlap guard holds that time while it is being paid for. It is paid through
the same seam as any booking and expires the same way if it isn't. Updating
`endsAt` in place would hand out the extra time before payment, which is free
parking. A booking's effective end is the latest confirmed extension's end.

**Monthly reservations (Phase 6) need a decision first.** A Mon–Fri 9–7 term
is many ranges, and the CHECK allows a spot booking exactly one. The options
are (a) reserve the whole term as one range, simple but blocking evenings and
weekends, or (b) a separate table checked in application code under a per-listing
advisory lock that the hourly path also takes. This is deferred until the owner
picks one.

## Phases

| # | Scope | Prototype screens |
|---|---|---|
| 0 | Schema parity for `db push`; `npm run db:push` script | — |
| 1 | Booking lifecycle: Upcoming / Active / Past, booking detail, cancel + refund, active parking, extend, Already parked; events off Home | Bookings ×5, Booking detail, Cancel, Cancelled, Active parking, Extend ×2, Already parked |
| 2 | Listing model (daily/monthly price, amenities, restrictions, entry point), stay pricing, fees, checkout breakdown + pay seam, confirmed, spot detail redesign, results map + filters, favourites | Home ×4, Results ×7, Filters ×2, Detail, Checkout ×3, Confirmed, Saved ×2 |
| 3 | Reviews (one-way, optional sub-ratings), rating aggregates | Rate, Review submitted, All reviews |
| 4 | Report a problem + alternatives; notifications inbox + preferences; profile screens | Report, Support, Notifications, Profile, Vehicles, Payment methods |
| 5 | Host: dashboard, host bookings, calendar blocks, earnings ledger, wizard additions | Host ×2, Dashboard ×2, Host bookings, Calendar, Earnings, wizard steps |
| 6 | Monthly reservations (after the decision above) | Home monthly, Results monthly, Checkout monthly |

## Phase 1 in detail

### Data

- `Booking.extendsBookingId String?` (self relation) plus an index.
- `Refund`: `id`, `bookingId` (unique), `amount Decimal`, `status`,
  `reason String?`, `reference String?`, `createdAt`, `updatedAt`, `processedAt?`.

### API

| Route | Who | Notes |
|---|---|---|
| `GET /bookings?scope=upcoming\|active\|past` | driver | `active` is new. Upcoming excludes started stays. Past includes expired holds, cancelled, completed. |
| `GET /bookings/active` | driver | now returns spot bookings too (it filtered through `parkingCapacity` only) |
| `GET /bookings/:id` | owner | adds `phase`, `refund`, `extensions`, and `access` (instructions) **only when CONFIRMED or COMPLETED** |
| `GET /bookings/:id/cancellation` | owner | refund quote under the policy: amount, rule applied, deadline |
| `POST /bookings/:id/cancel` | owner | `{ reason? }`. Atomic conditional update; a PENDING hold cancels with nothing to refund; a paid booking creates a `REFUND_PENDING` refund for the quoted amount. Repeating it returns the same result. |
| `GET /bookings/:id/extensions` | owner | options (+30 m, +1 h, +2 h) each marked available or not, with price and the reason when not |
| `POST /bookings/:id/extensions` | owner | `{ endsAt, idempotencyKey }` → child `PENDING` booking, 409 if taken |

### App

- `app/bookings.tsx`: three tabs; the Active tab leads with the parked card.
- `app/booking/[id]/index.tsx`: detail, status timeline, access (when
  released), location, payment status, cancellation; a cancelled booking shows
  its refund tracker here instead of on a separate route.
- `app/booking/[id]/cancel.tsx` and `app/booking/[id]/extend.tsx`.
- `app/parking.tsx`: the Home *Already parked* target. It shows active parking
  when there is a booking, else the "Are you already parked?" chooser.
- Home: the events list goes (its API stays), and *Already parked* navigates
  to `/parking`.

### Security checklist (Phase 1)

| Check | How |
|---|---|
| Auth | every route under `driver` (`authenticate`) |
| Authz | every read and write filters `driverId` in the WHERE, so a not-yours id is indistinguishable from a missing one (no enumeration oracle) |
| Input | zod on params (uuid), body (`reason` ≤ 200 chars, `endsAt` date, key 8–128) |
| Output | access instructions only on paid bookings of the owner; no host contact details; refund exposes amount/status/reference only |
| Integrity | cancel and extend are single conditional statements or transactions; the overlap guard is the source of truth for extensions; amounts are computed server-side only |
| Rate limit | none when Phase 1 shipped; added since — see *Cross-cutting* |
| Logging | none when Phase 1 shipped; added since — see *Cross-cutting* |

### Acceptance criteria

1. A confirmed booking whose start has passed appears under **Active**, not
   Upcoming, and `GET /bookings/active` returns it.
2. A confirmed booking whose end has passed is stored `COMPLETED` after the
   next list call and appears under **Past**.
3. Cancelling more than 1 h before start quotes 100%, inside the hour 50% of
   parking, after start refuses with 409. A paid cancellation creates exactly
   one `REFUND_PENDING` refund, even when repeated.
4. Another driver's booking id returns 404 on every route.
5. An extension over hours already booked returns 409 and creates nothing. One
   outside the spot's opening hours is shown unavailable with its reason.
6. Access instructions are absent from a `PENDING` booking's response.

## Phase 3 in detail — reviews

One-way: a driver rates a spot after a paid stay there. No host replies, no
driver ratings, no editing. One review per booking.

Written to the fullstack-guardian template (requirements in EARS form, the
three perspectives, then the plan); the sections after it hold the detail.

### Requirements (EARS)

- R1. While a booking is COMPLETED, paid (Payment CAPTURED), a host-spot
  booking and not an extension, when its driver submits 1–5 overall stars,
  the system shall store one review and show "Review submitted".
- R2. When a driver submits a second review for the same booking, the system
  shall refuse it (409) and keep the first.
- R3. While a booking is cancelled, unpaid, refunded, a no-show, not yet
  ended or an extension, when a review is submitted, the system shall refuse
  it with the reason.
- R4. When a driver opens someone else's booking to review it, the system
  shall answer as if it did not exist (404).
- R5. While a spot has at least one visible review, the system shall show its
  average and count on search cards, spot detail and saved spots, else "New".
- R6. When a driver opens a spot's reviews, the system shall show the summary
  (average, 5→1 breakdown, sub-rating averages) and the reviews newest first,
  filterable to 5★, 4★ or 3★ and below.
- R7. When a driver sets a minimum rating in Filters, the system shall hide
  spots below it and spots with no reviews, and say so.
- R8. When an admin sets `hiddenAt` on a review, the system shall drop it from
  every count, average and list, and the booking stays reviewed.

### Three perspectives

| | |
|---|---|
| **Frontend** | Past card and booking screen: *Rate Parking* / *Reviewed*. Rate screen (`booking/[id]/review`): spot photo and time, 1–5 stars with a word each (Terrible → Excellent), three optional sub-ratings in a card (tap again clears), comment ≤ 500 with counter, button reads *Choose a star rating* until one is picked; swaps to *Review submitted* in place. Detail: rating section; `spots/reviews`: summary, chips, "Verified booking", relative dates, "Show more". Filters: RATING Any / 3.5+ / 4.0+ / 4.5+. Loading, empty and error states on each. |
| **Backend** | `POST /bookings/:id/review`; `GET /spots/:id/reviews?stars&cursor&limit`; rating and count on `/spots/nearby` (`minRating` filter), `/spots/:id`, `/favorites`; `canReview`, own `review` and the cover photo on booking views. Aggregates on read. |
| **Security** | Auth on every route; ownership in the WHERE; zod `.strict()` bodies; public reviews carry no ids; comments rendered as text; `write` rate-limit bucket; `REVIEW_CREATED` audit and refusals logged (see *Cross-cutting*). |

### Implementation plan

- [x] Schema: `Review` (db push, previewed with `migrate diff`)
- [x] zod request schemas, service, controller, routes
- [x] Aggregates into search, detail, saved; `canReview` into booking views
- [x] Rate screen and Review submitted state; Past card and booking screen
- [x] Detail rating section, all-reviews screen, rating filter
- [x] Live-DB suite (68 checks) and browser pass
- [x] Guardian audit against the prototype: wording, star colour (#b45309),
      star chips, relative dates, "Verified booking", spot photo on the Rate
      screen, RATING filter — all brought in line

### Who may review

A booking is reviewable when **all** of these hold, checked in one query on the
API and mirrored as `canReview` on every booking the API returns:

- it is the caller's (`driverId` in the WHERE, as everywhere);
- it is a host-spot booking (`listingId` set) and not an extension
  (`extendsBookingId` null) — an extension is part of the stay it extends;
- `status = COMPLETED`, after the same lazy sweep the booking lists run, so a
  stay that ended a minute ago does not have to be listed first. `NO_SHOW` and
  `CANCELLED` are refused;
- its `Payment.status = CAPTURED`. A hold that was never paid, or one refunded
  in full, was not a stay;
- it has no review yet.

No time limit on reviewing — flagged as a product choice, not a rule.

### Data

`Review` (new table, `db push`):

| Column | Notes |
|---|---|
| `bookingId` | **unique** — the one-per-booking rule is the database's, so two submits racing each other produce one row and a 409 |
| `listingId`, `driverId` | copied from the booking inside the insert, never taken from the request |
| `rating` | 1–5, required |
| `easyToFind`, `asDescribed`, `access` | 1–5 each, optional |
| `comment` | ≤ 500 chars, trimmed, empty → null |
| `hiddenAt` | set by an admin to take a review down without deleting it; every read filters it out |

Ranges are enforced by zod only: a CHECK constraint needs raw SQL, which
`db push` cannot manage. Index `(listingId, hiddenAt, createdAt)` serves both
the aggregates and the newest-first page.

**Aggregates are computed on read**, not stored on `Listing`. A correlated
subquery on the indexed `listingId` is cheap at this size and cannot drift.
If search load ever needs it, a `ratingSum`/`ratingCount` pair updated in the
review insert's transaction is the next step.

### API

| Route | Who | Notes |
|---|---|---|
| `POST /bookings/:id/review` | owner | `{ rating, easyToFind?, asDescribed?, access?, comment? }` → 201 with the review. 404 not found / not yours; 409 with the reason when not reviewable or already reviewed |
| `GET /spots/:id/reviews?stars&cursor&limit` | driver | `summary` (average, count, 5→1 breakdown, sub-rating averages with their own counts — always over all reviews) + a newest-first page, optionally `stars=5\|4\|low`, + the spot's name. Same bookable-spot gate as `GET /spots/:id` |
| `GET /spots/:id` | driver | adds `rating` (the summary) and the three newest `reviews` |
| `GET /spots/nearby`, `GET /favorites` | driver | add `rating` (1 dp, null when none) and `reviewCount`; search takes `minRating` (1–5), which drops unrated spots |
| booking views | owner | add `review: { rating, createdAt } \| null` and `canReview` |

A reviewer appears as a first name and last initial ("Rahul S."), the same
rule the host's name follows. No user id, email or booking id is returned with
a public review.

### App

- `BookingCard` (Past tab): **Rate Parking** when `canReview`; the stars and
  "Review submitted" once reviewed.
- `app/booking/[id]/review.tsx`: overall stars (required), three optional
  sub-ratings, optional comment with a counter. Submitting replaces the form
  with the *Review submitted* state. Opening it for a booking that is not
  reviewable explains why instead of showing a form.
- Search cards and spot detail: ★ 4.6 (12) instead of the *New* chip once a
  spot has a review. Spot detail gets a rating section — average, 5→1 bars,
  sub-rating averages, the three newest reviews — and *See all reviews*.
- `app/spots/[id]/reviews.tsx`: the summary and every review, paged.

### Security checklist (Phase 3)

| Check | How |
|---|---|
| Auth | all routes under `driver` (`authenticate`) |
| Authz | the review insert reads the booking with `id` **and** `driverId` in the WHERE; a not-yours id answers 404 like a missing one. `listingId` and `driverId` on the row come from that read, never from the body |
| Eligibility | status + payment + no-extension + spot-booking in the same WHERE; the unique `bookingId` settles races |
| Input | zod: uuid params; ratings are integers 1–5; comment trimmed, ≤ 500, control characters stripped; unknown keys rejected (`.strict()`) |
| Output | public reviews carry display name, ratings, comment, date only; `hiddenAt` rows never leave the API |
| Stored XSS | comments are rendered as React Native `<Text>`, never as HTML |
| Rate limit | `write` bucket (60/min per user); one review per paid booking bounds it anyway |
| Logging | `REVIEW_CREATED` audit; refusals as `NOT_FOUND` / `VALIDATION_FAILED` security events |

### Acceptance criteria

1. A COMPLETED booking with a CAPTURED payment can be reviewed once; the
   second submit is 409 and no second row exists.
2. CANCELLED, PENDING, CONFIRMED-upcoming, NO_SHOW, unpaid-COMPLETED and
   extension bookings are refused with 409; another driver's booking is 404.
3. A CONFIRMED paid stay whose end has passed is reviewable without being
   listed first.
4. Out-of-range or non-integer ratings, an over-long comment and unknown fields
   are 400.
5. A spot's search card and detail show the average and count once reviewed,
   and *New* before; the breakdown sums to the count; a hidden review is in
   neither.

## Phase 4 in detail — problems, notifications, profile

Prototype boards: *Report a problem*, *Problem · support & alternatives*,
*Active parking* (its action grid), *Bookings · past* (the disputed card),
*Notifications* (Inbox, Settings), *Profile*, *My vehicles*, *Payment methods*.

### Requirements (EARS)

- R1. While a paid (Payment CAPTURED) host-spot booking is CONFIRMED or
  COMPLETED, from 1 h before its start until 24 h after its effective end,
  when its driver picks what's wrong (can't find it, occupied, gate locked,
  doesn't match the listing, host not responding, other) and optionally adds
  details and a photo, the system shall log one report, alert the host, and
  show *We're on it* with what happens next.
- R2. When a driver reports a booking that already has a report, the system
  shall return the existing report (409 with it), never a second one.
- R3. While a report is open, the system shall show the booking as *Under
  review* on its Past card and detail, with "You reported: …" and a link to
  the report.
- R4. When support resolves a report with a refund, the system shall create
  the booking's refund for the full amount paid and notify the driver; when
  without, it shall close the report and notify the driver.
- R5. When a driver opens a report, the system shall offer up to two spaces
  free now near the booked one (not the booked one) and a search.
- R6. When something happens to a driver's or host's booking, refund, report,
  payout or listing, the system shall add an inbox entry unless the
  recipient turned that kind off; booking confirmations and cancellations
  are always on.
- R7. When a driver opens the inbox within 30 min of a paid stay starting
  or ending, or the day after a stay they haven't rated, the system shall
  show that reminder once (unless turned off).
- R8. When a user opens Notifications, the system shall show unread entries
  first-class, grouped Today / Earlier, and mark what they opened as read.
- R9. When a user changes a notification setting, the system shall store it
  and apply it to entries created from then on.
- R10. When a driver adds a vehicle, the system shall take its make and
  model (optional), plate and type (Hatchback, Sedan, SUV, Bike, Van).
- R11. The Profile screen shall show name, email, phone, a Driver chip, a
  Host chip with live-space count when hosting, and rows for personal
  information, vehicles (count · default), saved parking (count), payment
  methods, notifications, language, help and terms, and log out.

### Three perspectives

| | |
|---|---|
| **Frontend** | Active parking: a 2×2 grid — Extend, Directions, Contact Host, Report a Problem — and the "we'll remind you" line. `booking/[id]/report` (six radio options, details ≤ 500, optional photo, *Choose what's wrong* until one is picked) → `booking/[id]/problem` (status, timeline, contact, alternatives). Past card and booking detail: *Under review*. `notifications` (Inbox / Settings tabs, a switch per kind). Profile hub restyled; `account/vehicles` gains make/model and body type; `account/payments` from the payments seam. |
| **Backend** | `ProblemReport`, `Notification`, `NotificationPreference`; `Vehicle.label`, `Vehicle.size`. Routes below. `notify()` is the one writer of inbox entries and applies preferences; reminders are materialised lazily on inbox read with a per-user dedupe key (the lazy-sweep pattern, no scheduler). |
| **Security** | All routes behind `authenticate`; every read/write filters `driverId`/`userId`; host alerts carry the driver's first name and initial only; the report photo URL must be one the API minted under `problem-photos/<bookingId>/`; zod `.strict()` bodies; `write` rate limit; audits `PROBLEM_REPORTED`, `PROBLEM_RESOLVED`, `VEHICLE_*`, `NOTIFICATION_PREFS_CHANGED`. |

### Data

- `ProblemReport`: `bookingId` **unique** (one per booking; races produce one
  row), `driverId`, `listingId` (copied from the booking), `category`,
  `details?` ≤ 500, `photoUrl?`, `status` OPEN → RESOLVED, `refunded?`,
  `resolutionNote?`, `resolvedAt?`, `resolvedBy?`.
- `Notification`: `userId`, `kind`, `title`, `body`, `bookingId?`,
  `listingId?`, `dedupeKey?` (unique with `userId`), `readAt?`,
  `createdAt`. Index `(userId, createdAt)`.
- `NotificationPreference`: one row per user, created on first write;
  absent means defaults (everything on except *offers*).
- `Vehicle.label?` (make and model, ≤ 60) and `Vehicle.size?`
  (HATCHBACK/SEDAN/SUV/VAN — the same values a spot's size limit uses, so
  "fits here" can be checked later). The prototype's *Bike* chip is
  `vehicleType BIKE`; the four others are `CAR` with that size, so pricing,
  which is per vehicle type, is unchanged.

### API

| Route | Who | Notes |
|---|---|---|
| `POST /bookings/:id/problem` | owner | `{ category, details?, photoUrl? }` → 201 report. 409 when not reportable (reason) or already reported (with the report) |
| `GET /bookings/:id/problem` | owner | the report, 404 when none |
| `POST /bookings/:id/problem/photo-upload-url` | owner | presigned PUT under `problem-photos/<bookingId>/`, images only, size-capped |
| `POST /admin/problems/:id/resolve` | admin | `{ refund, note? }`; refund = full captured amount, in one transaction with closing the report |
| `GET /admin/problems?status=OPEN` | admin | the queue |
| `GET /notifications?cursor` | self | materialises due reminders, then newest first |
| `GET /notifications/unread-count` | self | for the Profile row |
| `POST /notifications/read` | self | `{ ids?: uuid[] }`, none = all |
| `GET` / `PUT /notifications/preferences` | self | the Settings switches |
| booking views | owner | add `problem: { id, category, status, refunded, createdAt } \| null` |
| `GET /auth/me` | self | adds `savedCount`, `liveSpaces` |

### What is deliberately not built

- **Push and email delivery.** Preferences for both channels are stored; no
  FCM credentials exist and there is no scheduler, so only the in-app inbox
  is delivered. Flagged for production.
- **Masked calls to the host.** No telephony provider. *Contact Host* is shown
  disabled with that reason; *Contact Support* opens email.
- **Saved payment methods.** Payments are front-end only, through
  `fe/src/lib/payments.ts`; the screen lists what the gateway will offer and
  reads saved methods from that seam, which returns none until it is wired.
- **Languages.** *हिन्दी coming soon*, as the prototype says.

### Security checklist (Phase 4)

| Check | How |
|---|---|
| Auth | every route `driver` (authenticate); resolve/queue `admin` |
| Authz | report reads/writes: `id` + `driverId` in the WHERE; notifications: `userId` in every WHERE including `read` (updateMany scoped to the caller); a host's alert names the driver by first name + initial only |
| Input | zod `.strict()`: category enum, details trimmed ≤ 500 with control chars stripped, photoUrl must match the minted prefix; preference body all booleans; ids uuid |
| Output | no driver contact to hosts; no host contact to drivers; notification bodies built server-side from ids, never from user text (a report's details never appear in the host's alert) |
| Integrity | unique `bookingId` on reports; refund and resolution in one transaction; `Refund.bookingId` unique so a report can't refund a booking twice |
| Rate limit | `write` bucket; reminders materialise at most once per key |
| Logging | audits as above; refusals via the shared handler |

### Implementation plan

- [x] Schema: `ProblemReport`, `Notification`, `NotificationPreference`,
      `Vehicle.label/size` (db push; `migrate diff` showed additions only)
- [x] `notify()` + state sync; hooks in cancel, report, resolve, listing review
- [x] Problem service (report, photo presign, resolve with refund), routes
- [x] Active-parking grid, Report and *We're on it* screens, disputed card
- [x] Notifications (Inbox / Settings), Profile hub, Vehicles, Payment methods
- [x] Live-DB suite (50 checks) and browser pass

### Acceptance criteria

1. A paid, active booking can be reported once; a second report is 409 with
   the first; an unpaid, cancelled, far-future or long-finished booking is
   refused; another driver's booking is 404.
2. The host gets an inbox entry that names the driver's first name and the
   problem kind, and nothing the driver typed.
3. Resolving with a refund creates exactly one refund of the captured amount
   and a driver notification; the booking reads *Under review* before and
   shows the refund after.
4. Opening the inbox inside the 30-minute window creates one "starts soon"
   entry however many times it is opened; with the preference off, none.
5. `POST /notifications/read` with another user's ids changes nothing.
6. A vehicle round-trips make/model and size; *Bike* is stored as BIKE.

## Phase 5 in detail — the host side

Prototype boards: *Host tab* (and empty), *Listing dashboard* (and loading),
*Host bookings*, *Calendar & blocking*, *Earnings & payouts*, *List parking*
steps 1–12.

### Requirements (EARS)

- R1. When a host opens the Host tab, the system shall show this month's
  earnings after the 10% commission, the amount available for payout, this
  month's booking count, today's bookings (who is parked now, who is next),
  and each space with its status (Active with rating, In review, Draft with
  the step to continue at).
- R2. When a host opens a space, the system shall show today's bookings,
  upcoming count and next start, this month's net, the rating, today's list,
  and quick actions: pause new bookings, edit prices, block dates, access
  instructions.
- R3. While a space is paused, the system shall leave it out of search and
  refuse new bookings on it (quote says why); bookings already made and
  extensions of them are unaffected.
- R4. When a host lists their bookings, the system shall show paid bookings
  only (never unpaid holds), by Upcoming / Active / Completed / Cancelled,
  each with the driver's first name and initial, the vehicle (make and
  plate — needed at the gate), the stay, and "You earn ₹X of ₹Y".
- R5. When a host blocks time on a space, the system shall refuse new
  bookings, holds and extensions over it, and hide the space from searches
  that touch it; blocking over a confirmed booking or an unexpired hold is
  refused with the booking named, and *block free hours only* blocks the
  day's open hours around it.
- R6. When a host removes a block, the system shall make those hours
  bookable again.
- R7. When a host opens Earnings, the system shall show available (stays
  ended, not yet paid out), pending (not ended), paid out (in a PAID
  settlement), this month gross − commission = net, how one booking splits,
  a transactions list, and the masked payout account.
- R8. The wizard shall additionally ask for amenities, vehicle limits
  (height, largest vehicle, other rules), daily and monthly prices beside
  the hourly one, and the entry point.

### Three perspectives

| | |
|---|---|
| **Frontend** | `host.tsx` restyled (earnings card, today line, spaces with status/rating). `host/listing/[id]` (dashboard), `host/bookings` (4 tabs, per space or all), `host/listing/[id]/calendar` (two-week strip, day timeline, block / unblock, the confirmed-booking warning), `host/earnings`. Wizard: new `features` and `limits` steps; `pricing` gains daily / monthly; `access` gains the entry point. |
| **Backend** | `ListingBlock`; `Listing.bookingsPausedAt`, `Listing.rules`. `lib/listing-lock.ts`: a per-listing transaction-scoped advisory lock, taken by spot booking, extension and block creation, so "is it free?" and "take it" can't interleave between a booking and a block (the EXCLUDE only sees bookings). Host reads under `requireHost` with `hostProfileId` in every WHERE. |
| **Security** | Host routes: `authenticate` + `requireHost`; each read and write filters by the caller's `hostProfileId` (a not-yours id is 404). Drivers appear as first name + initial and plate; never email or phone. Money is computed server-side from the booking and refund rows. Blocks and pause are audited. |

### Data

- `ListingBlock`: `listingId`, `startsAt`, `endsAt`, `reason?` (≤ 100, the
  host's own note, shown only to the host), `createdBy`, `createdAt`.
  Index `(listingId, startsAt)`.
- `Listing.bookingsPausedAt?` (null = taking bookings); `Listing.rules?`
  (≤ 300, public: "No commercial vehicles").
- **Host earning** of a paid booking = `retained × (1 − commission)`, where
  `retained = max(0, amount − refund)` — a full refund leaves nothing, a
  late cancellation's 50% refund leaves half the parking. Status: *Pending*
  until the stay ends, then *Available*, then *Paid out* once its settlement
  item belongs to a PAID settlement.

### API

| Route | Notes |
|---|---|
| `GET /host/summary` | Host tab card: month gross/net, available, bookings this month, today |
| `GET /host/spots/:id/overview` | dashboard numbers, today's list, paused, photo count |
| `PATCH /host/spots/:id/pause` | `{ paused }` |
| `GET /host/bookings?listingId&scope&cursor` | scope upcoming / active / completed / cancelled |
| `GET /host/spots/:id/calendar?from&days` | per day: open windows, bookings, blocks (≤ 14 days) |
| `POST /host/spots/:id/blocks` | `{ kind: "range", startsAt, endsAt, reason? }` or `{ kind: "day", date, freeOnly, reason? }`; 409 naming the booking when it overlaps one |
| `DELETE /host/spots/:id/blocks/:blockId` | |
| `GET /host/earnings` | the ledger |
| `PUT /host/spots/:id/pricing` | rates gain `pricePerDay?`, `pricePerMonth?` |
| `PATCH /host/spots/:id/features`, `/limits` | amenities; height, size, rules |
| `PATCH /host/spots/:id/terms` | gains `entryPoint` |

### Editing a live space

A live space's day-to-day terms — prices, hours, access instructions and
entry point, amenities, limits and rules, photos — can be changed from its
dashboard; saving returns there instead of walking the rest of the wizard.
The name and type, the address and the ownership document stay locked once
live, because they are what review checked (`operableSpot` vs `editableSpot`
in spot-listing.service).

### Implementation plan

- [x] Schema: `ListingBlock`, `Listing.bookingsPausedAt`, `Listing.rules` (db push; additions only)
- [x] `lib/listing-lock.ts` in spot booking, extension and block creation; blocks and pause in search, quote, booking and extension options
- [x] host-operations service + routes (summary, overview, pause, bookings, calendar, blocks, earnings)
- [x] Wizard: `features` and `limits` steps; daily/monthly prices with the host's share; entry point
- [x] Host tab, listing dashboard, host bookings, calendar & blocking, earnings screens
- [x] Live-DB suite (52 checks) and browser pass

### What is deliberately not built

- **Vehicles at once.** One listing is one space: the `Booking_no_overlap`
  EXCLUDE (which must not change) allows one booking at a time. A host with
  three bays lists three spaces.
- **Masked calls** to the driver (as Phase 4).
- **Automatic payouts.** Settlements are still created by an admin; the
  Earnings screen shows what is available and says payouts are sent by
  GatePass rather than promising a date.
- **DigiLocker identity check** in the wizard: no integration; PAN and the
  ownership document remain the checks.
- **Labelled photo slots** (entrance / parking area): photos stay one ordered
  list; the dashboard's entrance-photo tip is shown when a space has fewer
  than two photos.

### Security checklist (Phase 5)

| Check | How |
|---|---|
| Auth | every route `host` (`authenticate` + `requireHost`) |
| Authz | `hostProfileId` in the WHERE of every listing, booking, block and earnings query; a block id must belong to the path's listing |
| Input | zod `.strict()`: ISO dates, `endsAt > startsAt`, a block ≤ 31 days, calendar window ≤ 14 days, reason ≤ 100, rules ≤ 300, height 100–500 cm, prices positive and capped |
| Output | driver as first name + initial; plate and vehicle label only on paid bookings of the host's own space; no driver email/phone |
| Integrity | advisory lock per listing around check-then-insert for bookings, extensions and blocks; the EXCLUDE still guards booking vs booking |
| Rate limit | `write` bucket for pause / blocks / wizard saves |
| Logging | `LISTING_PAUSED`, `LISTING_RESUMED`, `BLOCK_CREATED`, `BLOCK_REMOVED` audits |

### Acceptance criteria

1. A paused space is absent from search, its quote says it isn't taking
   bookings, a new booking is 409; an existing booking still reads normally.
2. A block hides the space from searches overlapping it and refuses bookings
   and extensions into it; removing it restores both.
3. Blocking a day with a confirmed booking is 409 naming the booking;
   *free hours only* creates blocks that exactly surround it.
4. Another host's space, booking list or block is 404.
5. Earnings: a completed paid booking of ₹60 parking shows ₹54 available; a
   late-cancelled one ₹27; a fully refunded one ₹0; in a PAID settlement it
   moves to paid out.
6. Host booking lists never include unpaid holds, and show the driver as
   "First L." with the plate.
