# Cashfree payments — technical design

Collects the driver's money through Cashfree PG. Built one API at a time; this document grows with each.

Driver payment, in build order:

| Step | Cashfree API / flow | Where | Status |
|---|---|---|---|
| 1 | Create Order `POST /pg/orders` | Driver books a spot (`POST /spot-bookings`) | **done** |
| 2 | React Native checkout (payment session) | `fe/src/lib/payments.ts` | next |
| 3 | Get Payments for an Order | Server-side verification | later |
| 4 | Payment webhook (`x-webhook-signature` / `x-webhook-timestamp`) | `POST /webhooks/cashfree` | later |
| 5 | Booking confirmation + 15-min hold handling | PENDING → CONFIRMED; paid-after-expiry | later |
| 6 | Create Refund | Cancellation / problem report | later |
| 7 | Refund status + refund webhook | `Refund` REFUND_PENDING → REFUNDED / FAILED | later |
| 8 | Host earnings / settlement ledger | — | later |

Host side, separate from the driver's payment:

| Cashfree API | Where | Status |
|---|---|---|
| Easy Split: Create Vendor / Update Vendor Details / Get Vendor | Listing wizard step 9, "Getting paid" | **done** |
| Easy Split: vendor status webhook (`VENDOR_STATUS_UPDATE`) | `POST /webhooks/cashfree` | with the payment webhook |
| Easy Split: Split After Payment | **2 minutes after the payment webhook confirms**, from a DB-backed job; skipped if the booking was cancelled meanwhile | later |

Because the split runs 2 minutes after payment, most cancellations come after it: Create Refund must then carry `refund_splits` taking the host's share back from the vendor (full refund: the host's whole 90%; late 50% refund: 90% of the refunded half).

## Owner decisions

| Question | Decision |
|---|---|
| When is the order created | **At booking time**, in the same request that places the 15-minute hold. |
| `customer_phone` (required by Cashfree) | **Asked at checkout.** No phone on the profile → the API refuses with `PHONE_REQUIRED` before any hold is placed; the app asks once and saves it to the profile. |
| Host / platform money split | **Easy Split, after payment** (Split After Payment API). Create Order carries **no** `order_splits`, so an order never depends on the host's vendor account. |
| Old `POST /payments` stub | **Replaced.** The route is removed; `Payment.razorpay*` becomes gateway-neutral. |

## Structure

```
be/src/integrations/payment/
  provider.ts            PaymentGateway interface + gateway-neutral types (the only thing services import)
  index.ts               getPaymentGateway(): the configured gateway, or null when PAYMENT_PROVIDER=none
  cashfree/
    client.ts            HTTP: base URL per environment, auth + version headers, x-request-id,
                         x-idempotency-key, timeout, retry (idempotent calls only), error mapping
    schemas.ts           zod schemas for Cashfree responses -- a response is validated, never trusted
    gateway.ts           CashfreeGateway implements PaymentGateway: neutral <-> Cashfree wire mapping
be/src/services/payment.service.ts   openOrder(): the Payment row + the gateway call, idempotent
```

Why this shape: services depend on `PaymentGateway`, not on Cashfree, so a second gateway (or a fake in tests) is one new folder. The wire format (snake_case, Cashfree statuses) never leaves `cashfree/`. The client knows HTTP, not bookings; the service knows bookings, not HTTP.

## Flow — create order at booking

1. `POST /spot-bookings` (driver JWT). With a gateway configured, the driver's phone is checked **first**: none → `409 PHONE_REQUIRED`, nothing held.
2. One DB transaction: the PENDING booking (hold 15 min) **and** its `Payment` row (`CREATED`, full amount, `gatewayOrderId = bk_<bookingId>`). Atomic: there is never a hold without a payment row.
3. After the transaction, `openOrder` calls Cashfree `POST /pg/orders`:
   - `order_id` = `gatewayOrderId`; `x-idempotency-key` = the Payment row id (a UUID, stable across retries)
   - `order_amount` = parking + platform fee + GST, from the booking row (never from the client)
   - `order_expiry_time` = the booking's `holdExpiresAt`, so no one can pay for time that's been released
   - `customer_details`: `customer_id` = user id (hyphens stripped, alphanumeric), `customer_phone` = 10 digits, email and name when valid
   - `order_tags`: `booking_id`, `listing_id` (ids only, for reconciliation)
4. The response is validated (zod) and cross-checked (same `order_id`, same amount). The Payment row stores `cf_order_id`, `payment_session_id` and the expiry.
5. The booking response gains `checkout: { provider, environment, orderId, paymentSessionId, expiresAt }` — owner-only, for the app's Cashfree SDK.

**Failure / retry:** Cashfree down or slow → the hold and the Payment row stay; the API answers 502. The app retries `POST /spot-bookings` with the **same `idempotencyKey`** (already supported) → replay path → `openOrder` again with the same `order_id` and idempotency key, so Cashfree returns the same order instead of making a second one. A replay whose order already exists and hasn't expired returns it without calling Cashfree.

`PAYMENT_PROVIDER=none` (default): bookings work exactly as before, with `checkout: null`.

## Configuration (`be/.env`)

| Key | Values | Notes |
|---|---|---|
| `PAYMENT_PROVIDER` | `none` \| `cashfree` | default `none` |
| `CASHFREE_ENV` | `sandbox` \| `production` | picks `sandbox.cashfree.com/pg` or `api.cashfree.com/pg` |
| `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET` | from the Cashfree dashboard | required when provider is `cashfree` |
| `CASHFREE_API_VERSION` | default `2026-01-01` | sent as `x-api-version` |

Boot refuses `NODE_ENV=production` with `CASHFREE_ENV=sandbox` (sandbox payments must never confirm real bookings).

## Data (`Payment`, migration `0019_create_payment` edited in place)

| Column | Was | Meaning |
|---|---|---|
| `provider` | new | `cashfree` |
| `gatewayOrderId` | `razorpayOrderId` | our `order_id` at the gateway; unique |
| `gatewayPaymentId` | `razorpayPaymentId` | `cf_payment_id`, from the webhook (later) |
| `gatewayOrderRef` | new | `cf_order_id` |
| `gatewaySessionId` | new | `payment_session_id` -- given only to the booking's driver |
| `gatewayExpiresAt` | new | order expiry |
| `amount` | parking only | **full total**: parking + platform fee + GST |

## Security checklist

| Check | How |
|---|---|
| Authentication | `POST /spot-bookings`, `GET /payments`: `authenticate` |
| Authorization | booking loaded with `driverId` in the WHERE; replay of another driver's idempotency key → 409 |
| Input validation | no amount, order id or gateway field is accepted from the client; existing zod `.strict()` booking body |
| Output | session id only in the owner's booking response; `GET /payments` returns id, booking, amount, status, dates -- no gateway ids |
| Secrets | client id/secret only from env, only in request headers; never logged, never in errors or `IntegrationError.raw` |
| Integrity | amount from the booking row; response `order_id` and `order_amount` must match what was sent; order expires with the hold |
| Idempotency | one Payment row per booking (unique `bookingId`); stable `x-idempotency-key`; retries only on idempotent calls (5xx / 429 / network) |
| Rate limiting | existing `write` bucket on `POST /spot-bookings` |
| Logging | audit `PAYMENT_ORDER_CREATED` (user, booking, payment, order ids); every Cashfree call logs `x-request-id`, status, latency -- no PII |

## Acceptance criteria

1. `PAYMENT_PROVIDER=none`: `POST /spot-bookings` behaves as before and returns `checkout: null`.
2. Cashfree on, driver without a phone → `409 PHONE_REQUIRED`, no booking row.
3. Cashfree on → 201 with `checkout.paymentSessionId`; one Payment row with the full total and the order ids.
4. Cashfree returns 500 then 200 → one retry with the same `x-idempotency-key`; 400 → no retry, API 502, hold kept.
5. Replaying the booking request with the same `idempotencyKey` returns the same order and doesn't call Cashfree again while it's valid.
6. A Cashfree response with a different amount or `order_id` is rejected.
7. `GET /payments` never returns the session id or gateway ids; `POST /payments` is gone.

## Host payout account — Easy Split vendor (wizard step 9)

**Owner decisions:** phone asked in step 9 when the profile has none (saved to the profile); host picks **Individual** or **Business** (business type asked only for Business); PAN + account number + IFSC + holder name mandatory; no address proof for now; status refreshed when the host opens the screen.

**Flow — `POST /host/payout-account`:**
1. Validate (zod `.strict()`): PAN, holder, account no., IFSC, `accountType` (default INDIVIDUAL), `businessType` (required for BUSINESS, refused otherwise), `phone` (only when the profile has none).
2. Host blocked at the gateway → 409 "contact support" (Update Vendor sends `status: ACTIVE`, so resubmitting must not unblock).
3. Phone: the profile's, else the typed one (normalised, saved; taken by another account → 409), else `409 PHONE_REQUIRED`.
4. First time → **Create Vendor** `POST /easy-split/vendors`, `vendor_id = host_<hostProfileId without hyphens>`. Already a vendor (or create answers "already exists" — an earlier answer was lost) → **Update Vendor** `PATCH /easy-split/vendors/:id`. Body: name, email, 10-digit phone, `verify_account: true` (penny drop + name match), `dashboard_access: false`, bank, `kyc_details { account_type, business_type (Business only), pan }`; settlement schedule left at Cashfree's default (T+1).
5. Cashfree's status → ours, through `setStatus` (so ACTIVATED publishes listings that were only waiting on payout):

| Cashfree vendor status | payoutKycStatus | issue | Host sees |
|---|---|---|---|
| ACTIVE | ACTIVATED | — | Ready to be paid |
| IN_BANK_VALIDATION, IN_BENE_CREATION, ON_HOLD, *anything new* | UNDER_REVIEW | — | Verification pending |
| BANK_VALIDATION_FAILED, BENE_CREATION_FAILED | REJECTED | BANK_ACCOUNT | Needs attention: check account / IFSC / name |
| ACTION_REQUIRED | REJECTED | KYC | Needs attention: check PAN |
| BLOCKED, DELETED | REJECTED | BLOCKED | Blocked: contact support (no Fix button) |

6. Cashfree refuses the details (4xx about the input) → **422 `PAYOUT_DETAILS_REJECTED`** with Cashfree's reason; nothing but the phone is saved. Our keys failing / outage → 502.

**Status sync — `GET /host/payout-account`:** while UNDER_REVIEW / PENDING, at most every 30 s, **Get Vendor** `GET /easy-split/vendors/:id`; best-effort (a Cashfree error shows the stored status). The `VENDOR_STATUS_UPDATE` webhook replaces this with the payment webhook.

**Data (`HostProfile`, migration `0010` edited in place):** `payoutAccountType`, `payoutBusinessType`, `payoutGatewayStatus` (Cashfree's raw word), `payoutIssue`, `payoutCheckedAt`; vendor id in the existing `payoutAccountId`.

**Security:** host routes behind `authenticate` + `requireHost`, profile from the session; responses masked (PAN `ABCPV****D`, account last 4); Cashfree's error body never includes the secret; audit `PAYOUT_VENDOR_SUBMITTED` / `PAYOUT_STATUS_CHANGED` (ids and statuses only).

**To confirm in sandbox:** the exact `account_type` string for individuals (`INDIVIDUAL` sent; the webhook sample shows "Individual"), and Cashfree's `business_type` list (only "Travel and Hospitality" confirmed — add the rest to `PAYOUT_BUSINESS_TYPES` in both apps).

## Not in this change

- The app side: phone prompt at checkout, the Cashfree SDK in `fe/src/lib/payments.ts`.
- Webhook, Get Order, confirmation of the booking, split, vendor, refunds (rows 2–5 above).
- Orders for extensions and event bookings.
