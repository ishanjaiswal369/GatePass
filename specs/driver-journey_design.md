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
| Rate limit | none in the API today — flagged as a gap, not added here (would be a new dependency) |
| Logging | the project has no logger by choice; state-changing refusals are ordinary 4xx responses |

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
