# Feature: Paying for extra time (Extend parking)

Status: built 2026-10-01. Builds on `specs/cashfree-payments_design.md`.

## Requirements (EARS)

- While a driver's paid stay is running, when they pick 30 min / 1 hr / 2 hr
  of extra time, the system shall price it at the spot's hourly rate, hold it
  for 15 minutes, and open a Cashfree order with the host's share split out --
  exactly as for a new booking.
- When the driver has no mobile number, or the host can't be paid, the system
  shall refuse before holding anything (`409 PHONE_REQUIRED` /
  `HOST_NOT_PAYABLE`), as for a booking.
- When the payment is captured, the system shall confirm the extra time, and
  the stay's end becomes the extra time's end.
- When the payment lands after the hold lapsed, the system shall confirm it
  if the hours are still free, else refund it in full (unchanged rule).
- When extra time is confirmed after the stay reached its old end and was
  swept to COMPLETED, the system shall reopen the stay (CONFIRMED).
- After payment the driver lands on the booking, with "Extra time confirmed".

Options stay fixed at 30 / 60 / 120 minutes (owner's decision, 2026-10-01).
A space rented only by the day offers no extra time, as before.

## Architecture

The extension is a `Booking` row of its own (`extendsBookingId` = the stay),
so every existing payment path applies to it by id with no special casing.

### [Backend]
- `POST /bookings/:id/extensions` (booking-extension.service `create`):
  1. `assertCanPay(driverId, listingId)` before the hold;
  2. `openPaymentRow(tx, extension)` inside the hold's transaction;
  3. `openOrder(extensionId)` after commit (outside the listing lock).
  Answers `{ extensionId, checkout, booking }`.
- Split: `splitFor` computes `hostShareOf(extension.amount)` from the
  extension's own listing -> host vendor. Nothing new.
- UPI: `POST /bookings/:extensionId/pay/upi` (already generic).
- Confirmation: `resolvePaidBooking` (already generic) + new
  `reopenExtendedStay(parentId)`: `COMPLETED -> CONFIRMED` on the parent.
- Refunds: the late-payment refund rules apply to the extension row.
  Driver cancellation of extra time on its own stays refused.

### [Frontend]
- `extend.tsx`: create the hold, then `router.replace` to
  `/booking/[extensionId]/pay?method=UPI&parent=<stay>`. A pending extension's
  "Pay & Extend" goes to the same place. The "payments off" stub is removed.
- `pay.tsx`: with `parent` (or `booking.extendsBookingId`), CONFIRMED goes to
  `/booking/[parent]?extended=1`, not "Booking Confirmed"; back, refund and
  expired exits lead to the stay; header says "Extra time".
- `booking/[id]/index.tsx`: "Extra time confirmed · You can stay until …"
  when `extended=1`; the unpaid-extension notice pays directly.

### [Security]
- Auth: route behind `driver` (JWT). Authz: every read is scoped by
  `driverId` (`loadRunning`, the pre-check, `openOrder`, `startUpi`); another
  driver's booking answers 404.
- Input: `minutes` must be one of `EXTENSION_STEPS` (zod);
  `idempotencyKey` 8-128 chars; a key used by another driver or for another
  stay is `409`. Amount, listing, vehicle and times are server-derived.
- Money: the order amount comes from the Payment row, split fixed on the row
  the first time; the app never states a price. Confirmation only from the
  gateway (webhook / Get Payments), never from the app.
- Abuse: one live pending extension per stay (`409`), so one open order at a
  time; global rate limit applies.
- Output: the response carries the checkout session id (needed by the app,
  same as a booking), no gateway secrets, no other driver's data.
- Audit: `EXTENSION_HELD`, `PAYMENT_ORDER_CREATED`, `BOOKING_CONFIRMED`,
  `BOOKING_REOPENED_BY_EXTENSION`, `PAYMENT_REFUND_OPENED`.

## Implementation Plan
- [x] Backend: payment steps in `booking-extension.service.create`
- [x] Backend: `reopenExtendedStay` in payment-confirmation
- [x] Frontend: extend -> pay screen; pay screen extension routing; notice
- [x] Typecheck both; API check against the running container
- [x] Security review
