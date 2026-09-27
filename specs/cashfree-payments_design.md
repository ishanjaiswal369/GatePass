# Cashfree payments — technical design

Collects the driver's money through Cashfree PG. Built one API at a time; this document grows with each.

Driver payment, in build order:

| Step | Cashfree API / flow | Where | Status |
|---|---|---|---|
| 1 | Create Order `POST /pg/orders` | Driver books a spot (`POST /spot-bookings`) | **done** |
| 2 | Order Pay `POST /pg/orders/sessions`: UPI (intent / QR) via the API, card (sandbox only) from the app | `POST /bookings/:id/pay/upi`, `fe/src/lib/payments.ts` | **done** |
| 3 | Get Payments for an Order `GET /pg/orders/{id}/payments` | On the driver's booking read (`GET /bookings/:id`), throttled | **done** |
| 4 | Payment webhook (`x-webhook-signature` / `x-webhook-timestamp`) | `POST /webhooks/cashfree`, `notify_url` per order | **done** (live test needs the tunnel) |
| 5 | Booking confirmation + 15-min hold handling | PENDING → CONFIRMED; paid-after-expiry | **done** (with step 3) |
| 6 | Create Refund | Cancellation / problem report | later |
| 7 | Refund status + refund webhook | `Refund` REFUND_PENDING → REFUNDED / FAILED | later |
| 8 | Host payouts shown in earnings: Easy Split settlement webhook (the manual `Settlement` tables were deleted 2026-09-27) | earnings `paidOut`, `HOST_PAYOUT` notice | **done** |

Host side, separate from the driver's payment:

| Cashfree API | Where | Status |
|---|---|---|
| Easy Split: Create Vendor / Update Vendor Details / Get Vendor | Payouts screen (`/host/payouts`, from the Host tab card) — see `host-payouts_design.md` | **done** |
| Easy Split: vendor status webhook (`VENDOR_STATUS_UPDATE`) | `POST /webhooks/cashfree` → Get Vendor → `record` | **done** (URL set in the Cashfree dashboard) |
| Easy Split: vendor settlement webhook (`VENDOR_SETTLEMENT_*`) | `POST /webhooks/cashfree` → `HostPayout` rows, earnings, notifications | **done** (URL set in the Cashfree dashboard) |
| Easy Split: **split on the order** (`order_splits` in Create Order) — replaced Split After Payment on 2026-09-27 | `openOrder`: host's vendor + parking less the service fee | **done** |

Refunds after a split: by default Cashfree debits the vendor's balance **in proportion to their share** (Easy Split FAQ). For a ₹40 order with ₹36 to the host, a ₹20 refund takes ₹18 from the host, leaving 90% of what was kept, which is our earnings formula. So `refund_splits` may not be needed; confirm at the Create Refund step.

## Owner decisions

| Question | Decision |
|---|---|
| When is the order created | **At booking time**, in the same request that places the 15-minute hold. |
| `customer_phone` (required by Cashfree) | **Asked at checkout.** No phone on the profile → the API refuses with `PHONE_REQUIRED` before any hold is placed; the app asks once and saves it to the profile. |
| Host / platform money split | **Easy Split on the order** (`order_splits`), owner's decision 2026-09-27, reversing "Split After Payment" (26 Sep). No job, worker or queue: Cashfree settles the host's share itself. Safe because a listing is only bookable while the host's vendor is ACTIVATED. A host with no vendor → payment refused (`409 HOST_NOT_PAYABLE`), before any hold. |
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
   - `order_amount` = the booking's total, from the booking row (never from the client). Since 2026-09-26 that is the **parking amount only**: there is no driver-side fee; GatePass's service fee (`COMMISSION_RATE`, 10%) comes out of the host's share at the split
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
| `amount` | parking only | **full total** the driver pays (booking amount + platformFee + taxAmount; the last two are now 0) |

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

## Pay with a chosen method — Order Pay (step 2)

**Owner decisions (2026-09-27):** UPI first; **netbanking removed**; **card only for sandbox testing** (production later); must work on iOS and Android, not just web.

**Probed in sandbox (2026-09-27):** Order Pay answers 200 for UPI `link`, UPI `qrcode`, and card. It is authorised by `payment_session_id` alone; the client id/secret isn't needed. One session takes any number of attempts (each gets its own `cf_payment_id`), so "try again" and switching method need no new order. `transaction_expiry_time` must be 1–3 minutes ahead (we omit it). CORS allows any origin but only standard headers (not `x-client-*`). `order_meta.return_url` accepts http and custom schemes.

**Production blocker (not solved here):** Order Pay needs Cashfree's S2S flag on the account. The card flag needs a PCI DSS certificate; the flag for other methods needs a GST return showing more than ₹1 Cr annual turnover. Until then, production must fall back to Cashfree's hosted checkout.

| Method | Who calls Order Pay | Why |
|---|---|---|
| UPI (`link` on phones, `qrcode` on desktop web) | **the API**, `POST /bookings/:id/pay/upi` | server validates, allow-lists the links it hands out, audits each attempt |
| Card (sandbox only) | **the app, straight to Cashfree** with the session id | card number / CVV never reach GatePass's servers or logs |

**`GET /payments/options`** (driver): `{ enabled, environment, apiVersion, methods }`; `methods` is `["UPI"]`, plus `"CARD"` only when `CASHFREE_ENV=sandbox`.

**`POST /bookings/:id/pay/upi`** (driver, `write` bucket). Body (zod `.strict()`):

| Field | Values |
|---|---|
| `channel` | `"INTENT"` (open a UPI app) \| `"QR"` (scan) |
| `client.device` | `mobile` \| `desktop` \| `tablet` |
| `client.os` | `android` \| `ios` \| `windows` \| `macos` \| `linux` \| `others` |
| `client.rendering` | `native` \| `mweb` \| `webview` (optional) |
| `client.browser` | `chrome` \| `safari` \| `firefox` \| `edge` \| `others` |

Flow: `openOrder` (ownership in the WHERE, live PENDING hold, `CREATED` row; opens the order if the first attempt failed) → nothing payable → `409 NOT_PAYABLE` → Order Pay `{ upi: { channel: link | qrcode } }` with the `x-client-*` headers → response checked (zod) → audit `PAYMENT_ATTEMPT_STARTED`. Answer: `{ channel: "INTENT", apps: { default?, gpay?, phonepe?, paytm?, bhim? }, expiresAt }` or `{ channel: "QR", qrImage, expiresAt }`.

**Link allow-list:** an app link is kept only if it is `https://*.cashfree.com` (sandbox's simulator) or one of the UPI schemes `upi:`, `tez:`, `gpay:`, `phonepe:`, `paytmmp:`, `paytm:`, `bhim:`. Anything else is dropped; none left → 502. The QR must be a `data:image/png;base64` image under 512 KB. Never retried (no idempotency key): a timed-out attempt is just an unused attempt.

**Card (sandbox):** the app posts `{ payment_session_id, payment_method: { card: { channel: "link", … } } }` to Cashfree, takes `data.url` (must be `https://*.cashfree.com`), and opens it: native in an auth session (`expo-web-browser`), web in the same tab.

**Coming back:** Create Order now sets `order_meta.return_url = {API_PUBLIC_URL}/payments/return?order_id={order_id}`. `GET /payments/return` (public) only checks `order_id` is `bk_<uuid>` and answers 302: `gatepass://booking/<id>/pay` for a phone user agent, `{APP_WEB_URL}/booking/<id>/pay` otherwise. It reads nothing and changes nothing, and its targets are fixed, so it can't be an open redirect.

**The app, `/booking/[id]/pay`:** starts the UPI attempt, then either opens the chosen app (native opens it automatically; web waits for a tap) or shows the QR. It polls `GET /bookings/:id` every 4 s and counts down to the hold's expiry. Confirmation only ever comes from the API (steps 3–5); until those are built this screen keeps waiting.

| Platform | UPI | Card (sandbox) |
|---|---|---|
| Android app | app list incl. "Any UPI app" (`default` → system chooser) | auth session → back via `gatepass://` |
| iOS app | GPay / PhonePe / Paytm / BHIM (no generic `upi://` chooser on iOS) | same |
| Phone browser | app list (Android or iOS set by user agent) | same tab |
| Desktop browser | QR | same tab |

In Expo Go the scheme is `exp://`, not `gatepass://`: the card page doesn't close itself, and the driver closes it and lands on the polling screen. UPI is unaffected.

**Config (`be/.env`):** `API_PUBLIC_URL` (default `http://127.0.0.1:3000`; for a phone, the LAN address), `APP_WEB_URL` (default `http://localhost:8081`).

**Security:** auth on both driver routes; booking loaded with `driverId`; no amount, order id or URL taken from the client; client hints are enums; links allow-listed; card data never on our servers; the session id stays owner-only; audit ids only.

**Acceptance:** (1) options lists CARD in sandbox only; (2) UPI INTENT returns only allow-listed links, QR returns a PNG data URL; (3) another driver's booking → 404, an expired or paid hold → 409; (4) Cashfree 4xx → 502 with no retry; (5) Create Order carries `return_url`; (6) `/payments/return` redirects only to the two fixed targets and refuses a malformed `order_id`.

## Confirming a paid booking — Get Payments for Order (steps 3 + 5)

**Owner decisions (2026-09-27):** build order Get Payments → webhook + tunnel → Split After Payment. A payment that lands after its hold lapsed: **confirm if the hours are still free, else refund in full**. A split that can't run (vendor not ACTIVE, Cashfree error): hold it and retry until it can.

**Trigger:** `GET /bookings/:id` (the pay screen polls it every 4 s) first runs `refreshPayment(bookingId, driverId)` (`services/payment-confirmation.service.ts`):
- no gateway, no row of this driver's, row not `CREATED`, or the order closed more than 30 min ago → nothing (no Cashfree call);
- one conditional write on `Payment.gatewayCheckedAt` claims the check → at most one Cashfree call per booking per 5 s across all requests;
- `GET /pg/orders/{order_id}/payments`; a gateway error leaves things as they were (next read retries).

**`recordSuccess`** (the webhook will call the same): refuses a payment for another order, another currency, or a different amount (audit `PAYMENT_MISMATCH`, nothing changes); else `CREATED → CAPTURED` + `gatewayPaymentId`, conditional, audit `PAYMENT_CAPTURED`.

**`resolvePaidBooking`** (re-runnable; each branch moves only from the state it expects):

| Booking when the money lands | Result |
|---|---|
| `PENDING` (hold live, or lapsed but nobody took the hours; taking them sweeps it first) | `CONFIRMED` |
| `CANCELLED`, no `cancelledAt` (lapsed hold swept by another attempt) | listing lock + block check + update → `CONFIRMED`; overlap (23P01) or host block → **refund `HOLD_LAPSED`** |
| `CANCELLED` by the driver | refund `CANCELLED_BEFORE_PAYMENT` |
| stay already ended | refund `PAID_AFTER_STAY` |
| already `CONFIRMED` / refunded | nothing |

Refunds are `Refund` rows (full amount, `REFUND_PENDING`); sending them to Cashfree is step 6 (Create Refund). Notifications (confirmed, refund started) come from the existing state sync.

**Schema:** `Payment.gatewayCheckedAt` (migration `0019` edited in place).

**Verified 2026-09-27:** fake-Cashfree suite (every branch above, throttle, other driver, amount mismatch, 19-digit id kept as a string); real sandbox: simulator SUCCESS → pay screen → "Booking Confirmed"; a lapsed-but-free hold confirmed; a driver-cancelled booking paid later → refund.

## Payment webhook — `POST /webhooks/cashfree` (step 4)

**Owner decisions (2026-09-27):** the webhook URL goes with each order as `order_meta.notify_url` (no dashboard setting). Development reaches this machine through a **cloudflared** quick tunnel. Production doesn't need one: `WEBHOOK_PUBLIC_URL` is the API's own domain.

- **Config:** `WEBHOOK_PUBLIC_URL` (https only; required when `NODE_ENV=production` with Cashfree). Unset → orders carry no `notify_url`, and bookings still confirm through the pay screen's check. Dev: `npm run tunnel` (`cloudflared tunnel --url http://127.0.0.1:3000`), paste the printed `https://….trycloudflare.com` into `be/.env`, then `docker compose up -d be`. A quick tunnel's URL changes on every start, and only orders created after that carry it.
- **Signature:** `Base64(HMAC-SHA256(x-webhook-timestamp + raw body, CASHFREE_CLIENT_SECRET))`, per Cashfree's signature docs (their Node example concatenates with no separator), compared with `timingSafeEqual`. The route lives in its own Fastify scope whose JSON parser keeps the raw string, so no other route's parsing changes.
- **Handling:** a genuine webhook is only a nudge. Its `data.order.order_id` finds our Payment row, and the **same Get Payments call** as the pay screen decides (`settleFromGateway` → `recordSuccess` → `resolvePaidBooking`). So the body's 19-digit `cf_payment_id` (a JSON number, which loses digits) is never used, and a replay or duplicate changes nothing. Not throttled and not limited to recent orders, unlike a screen's check.
- **Responses:** `200` handled or ignored (not our order), `401` bad or missing signature (security event `WEBHOOK_SIGNATURE_INVALID`), `5xx` when Cashfree can't be asked, so Cashfree retries (default at 2, 10 and 30 min). Audit `PAYMENT_WEBHOOK_RECEIVED`.
- **Rate limit:** exempt (Cashfree sends from a few shared IPs; the signature bounds it).
- **Verified 2026-09-27:** fake suite (forged, tampered, re-serialised, wrong timestamp, outage → throws, genuine → CONFIRMED despite a recent check, duplicate → no change, foreign order → ignored). Real HTTP against the Docker API: genuine 200, wrong secret, tampered or no headers 401, 70/min from one IP all 200. **Not yet:** Cashfree actually delivering one, which needs the tunnel.

## Easy Split webhooks — vendor status and settlements

**Owner decisions (2026-09-27):** hosts are paid automatically by Easy Split, with no wallet and no withdraw button. A new `HostPayout` table holds one row per transfer. Earnings show transfer rows, not a "paid" mark on each booking. A failed or returned transfer is told to the host: a notification, plus a notice on the Payouts screen saying what to fix.

**Setup:** both webhooks are configured **in the Cashfree dashboard** (Easy Split → webhooks: *Vendor Status Change* and *Vendor Settlement*), not per order. Point them at the same `https://<public>/webhooks/cashfree` as the payment webhook. One route, one signature check (`timestamp + raw body`, client secret), dispatched by `type` in `services/gateway-webhook.service.ts`.

**`VENDOR_STATUS_UPDATE`** (docs: api-reference/…/split/webhooks/vendor-status-change-webhooks): only `data.merchant_vendor_id` is read. The body also carries the vendor's bank account, phone and email, which are never used or logged. Then **Get Vendor** → `record()` (same path as the Payouts screen), so ACTIVATED publishes waiting listings with nobody opening a screen. Unknown vendor → 200 + audit `PAYOUT_WEBHOOK_IGNORED`. Cashfree down → 5xx (retried). The Payouts screen's 30 s check stays as a fallback.

**`VENDOR_SETTLEMENT_INITIATED | SUCCESS | FAILED | REVERSED`** (docs: payments/split/webhooks). One transfer of a vendor's balance to their bank, with **no order list** (`settled_orders_count` only). There is no API to ask back, so the signed body is the record:
- **Parsed** (`toSettlement`): `settlement_id` (number or string, stored as a string; an unsafe integer is refused), amount = `amount_settled ?? settlement_amount ?? vendor_transaction_amount`, `utr`, `reason`, `payment_from/till` (bare dates read as IST days), `settlement_initiated_on`, `settled_on`. Cashfree's examples write missing values as the string `"null"`, which is read as null. The docs call the first event both `…_INITIATED` and `…_CREATED`, and both map to INITIATED.
- **`HostPayout`** (migration `0025_create_host_payout`): unique `gatewaySettlementId`. Status only moves up a rank: INITIATED(0) → SUCCESS | FAILED(1) → REVERSED(2). A late or duplicate webhook changes nothing, and moves are conditional on the status read.
- **Notifications** (`HOST_PAYOUT`, dedupe `payout:<id>:<status>`): SUCCESS "Payout sent ₹X … •• 1234 · UTR". FAILED "couldn't reach your bank", REVERSED "returned by your bank", with the reason in words and "update your bank details" only when the reason is the host's account (IFSC, account number, name mismatch, blocked, NRE, payout inactive…).
- **Earnings:** `paidOut` = sum of SUCCESS. Rows: SUCCESS "Payout to your bank" (PAID_OUT), INITIATED "Payout on its way" (PENDING). Failed transfers aren't rows.
- **Payouts screen:** `lastTransferIssue` = the latest finished transfer if it FAILED or REVERSED (cleared by a later SUCCESS). If the host changed bank details since, it doesn't ask again.

**Verified 2026-09-27:** fake suite (21 checks: parsing, `"null"`, CREATED alias, unsafe id, INITIATED → SUCCESS → duplicate → late INITIATED → REVERSED, FAILED fixable vs bank-side, earnings totals and rows, unknown vendor, forged). Real HTTP on the Docker API: vendor status for the real sandbox vendor → real Get Vendor 200; unknown vendor/settlement 200 ignored; forged 401. **Not yet:** Cashfree actually delivering either. That needs the tunnel + dashboard URLs, and a paid split order settling (seed host needs a vendor first). `POST /pg/simulate/settlement` exists in sandbox; whether it triggers vendor settlements is untested.

## Host's share — `order_splits` on Create Order

**Why not Split After Payment + a worker/queue:** that needed a 2-minute delayed job, a table, retries and a worker container (RabbitMQ was considered and rejected: a DB outbox would be needed anyway). Putting the split on the order makes Cashfree do all of it.

- **Amount:** `hostShareOf(booking.amount)` = parking × (1 − `COMMISSION_RATE`), to the paisa (`config/pricing.ts`). The host earnings screen uses the same function.
- **Fixed once:** `Payment.splitVendorId` / `splitAmount` are written the first time the order is opened (conditional on unset). A retry sends the same split, and a later rate change never rewrites an existing order.
- **Checked:** the order Cashfree returns must carry exactly the split sent (vendor + amount in paise), else it's refused like an amount mismatch.
- **No payee:** `assertCanPay(driverId, listingId)` runs before the hold. A host without `payoutAccountId` or not `ACTIVATED` → `409 HOST_NOT_PAYABLE`, audit `PAYMENT_HOST_NOT_PAYABLE`, nothing held, Cashfree not called. `openOrder` checks again (stale case).
- **Probed 2026-09-27:** sandbox accepts `order_splits` to an ACTIVE vendor (echoes `vendor_id`, `amount`, `percentage: null`, `tags: null`). An unknown vendor → 400 "Vendor Not found".
- **Vendor inactive on settlement day:** the split credits the vendor's balance. The bank transfer fails with a reason (`PAYOUT_INACTIVE`, `INVALID_ACCOUNT_FAIL`…) reported by the Easy Split settlement webhook, so the money isn't lost. Settlement is T+2 by default, once a day.
- **Dev data:** the seed host (`seed-host@gatepass.local`, all 7 seed spots) is ACTIVATED with no vendor, so seed spots refuse payment until the owner adds bank details on its Payouts screen (owner's choice).
- **Open for later:** the old manual `Settlement` ledger was deleted on 2026-09-27, so there's no double-payment path. Consider an order-level settlement delay until the stay ends (Cashfree "Delay Settlements").

## Host payout account — Easy Split vendor (Payouts screen)

**Owner decisions:** phone asked on the Payouts screen when the profile has none (saved to the profile); host picks **Individual** or **Business**; only a Business picks a business type; PAN + account number + IFSC + holder name mandatory; no address proof for now; status refreshed when the host opens the screen.

**Business type and individuals.** Cashfree's docs describe `business_type` as a business-account field, but this account's sandbox refuses Create Vendor without it for an individual too. Probed 2026-09-26: `account_type` `INDIVIDUAL`, `Individual` and absent, on API versions 2026-01-01, 2025-01-01 and 2023-08-01 → every one `400 kyc_details.business_type_missing`. **Owner's decision (2026-09-26): an individual is sent without `business_type`** — the owner has seen Cashfree accept `{ account_type: "Individual", pan }` alone. The host isn't asked and nothing is stored; a business picks its own and it is sent. If Cashfree refuses an individual (as the probe above did), the host sees its reason as a 422 `PAYOUT_DETAILS_REJECTED`.

**Accepted payload — `POST /host/payout-account`** (zod `.strict()`: an unknown field is a 400):

| Field | Type | Required | Rule |
|---|---|---|---|
| `accountType` | `"INDIVIDUAL"` \| `"BUSINESS"` | yes | |
| `businessType` | one of `PAYOUT_BUSINESS_TYPES` | **BUSINESS only** — required there, refused for INDIVIDUAL | today: `"Travel and Hospitality"` |
| `panNumber` | string | yes | `ABCDE1234F` (uppercased) |
| `accountHolderName` | string | yes | 1–120, as the bank has it |
| `accountNumber` | string | yes | 9–18 digits |
| `ifsc` | string | yes | `AAAA0XXXXXX` (uppercased) |
| `phone` | string | only when the profile has none (`needsPhone`) | 10-digit Indian mobile, `+91` optional |

```json
{
  "accountType": "INDIVIDUAL",
  "panNumber": "ABCDE1234F",
  "accountHolderName": "Test Vendor",
  "accountNumber": "123456789012",
  "ifsc": "HDFC0001234",
  "phone": "9999999999"
}
```

Responses: **201** the masked account (below); **400** validation (`{ errors: [...] }`); **409** `PHONE_REQUIRED` / phone on another account / already active / under review / blocked; **422** `PAYOUT_DETAILS_REJECTED` with Cashfree's reason; **502** Cashfree unreachable or our keys refused.

**Flow — `POST /host/payout-account`:**
1. Validate against the payload above.
2. Host blocked at the gateway → 409 "contact support" (Update Vendor sends `status: ACTIVE`, so resubmitting must not unblock).
3. Phone: the profile's, else the typed one (normalised, saved; taken by another account → 409), else `409 PHONE_REQUIRED`.
4. First time → **Create Vendor** `POST /easy-split/vendors`, `vendor_id = host_<hostProfileId without hyphens>`. Already a vendor (or create answers "already exists" — an earlier answer was lost) → **Update Vendor** `PATCH /easy-split/vendors/:id`. Body: name, email, 10-digit phone, `verify_account: true` (penny drop + name match), `dashboard_access: false`, bank, `kyc_details { account_type, business_type (BUSINESS only), pan }`; settlement schedule left at Cashfree's default (T+1).
5. Cashfree's status → ours, through `setStatus` (so ACTIVATED publishes listings that were only waiting on payout):

| Cashfree vendor status | payoutKycStatus | issue | Host sees |
|---|---|---|---|
| ACTIVE | ACTIVATED | — | Ready to be paid |
| IN_BANK_VALIDATION, IN_BENE_CREATION, ON_HOLD, *anything new* | UNDER_REVIEW | — | Verification pending |
| BANK_VALIDATION_FAILED, BENE_CREATION_FAILED | REJECTED | BANK_ACCOUNT | Needs attention: check account / IFSC / name |
| ACTION_REQUIRED | REJECTED | KYC | Needs attention: check PAN |
| BLOCKED, DELETED | REJECTED | BLOCKED | Blocked: contact support (no Fix button) |

6. Cashfree refuses the details (4xx about the input) → **422 `PAYOUT_DETAILS_REJECTED`** with Cashfree's reason; nothing but the phone is saved. Our keys failing / outage → 502.

**Status sync — `GET /host/payout-account`:** the database is the answer; Cashfree is asked only while it owes one.

| Stored status | Get Vendor called? |
|---|---|
| NOT_STARTED (no vendor yet) | never |
| ACTIVATED | never — shown from the DB |
| REJECTED | never — waits on the host (Fix details → Update Vendor) |
| PENDING / UNDER_REVIEW | at most once per 30 s **per host across all requests**: the slot is claimed with one conditional write on `payoutCheckedAt`, so the Host and Payouts tabs loading together make one call |

Best-effort: a Cashfree error shows the stored status. The `VENDOR_STATUS_UPDATE` webhook will replace the polling.

**Updating an active account (owner's decision, 2026-09-26):** an ACTIVATED host can change bank details (Payouts → *Update bank details*; holder and IFSC prefilled, PAN and account number re-entered). It is sent as **Update Vendor** and the status follows Cashfree's re-check — usually back to UNDER_REVIEW — so the host's spaces stop taking bookings until the new account is verified; money never goes to an unverified account. While UNDER_REVIEW / PENDING no change is accepted (409).

**Data (`HostProfile`, migration `0010` edited in place):** `payoutAccountType`, `payoutBusinessType`, `payoutGatewayStatus` (Cashfree's raw word), `payoutIssue`, `payoutCheckedAt`; vendor id in the existing `payoutAccountId`.

**Security:** host routes behind `authenticate` + `requireHost`, profile from the session; responses masked (PAN `ABCPV****D`, account last 4); Cashfree's error body never includes the secret; audit `PAYOUT_VENDOR_SUBMITTED` / `PAYOUT_STATUS_CHANGED` (ids and statuses only).

**Confirmed in sandbox (2026-09-26):** Create Vendor with `account_type: "INDIVIDUAL"` + `business_type: "Travel and Hospitality"` → 200, status `IN_BANK_VALIDATION`. **Still to confirm:** Cashfree's `business_type` list (only "Travel and Hospitality" confirmed — add the rest to `PAYOUT_BUSINESS_TYPES` in both apps).

## Not in this change

- Webhook, Get Order, confirmation of the booking, split, vendor, refunds (rows 2–5 above).
- Orders for extensions and event bookings.
