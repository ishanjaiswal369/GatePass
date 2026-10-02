# Feature: Cashfree refunds (Create Refund, status, webhook, retry)

Status: built 2026-10-01. Steps 6-7 of `specs/cashfree-payments_design.md`.

Verified in the sandbox on 2026-10-03, from the phone: UPI payment -> booking
confirmed -> driver cancel (`LATE`, Rs 9.38 of Rs 18.75, host's part Rs 8.44)
-> Create Refund 200 `PENDING` -> `REFUNDED` five seconds later with
Cashfree's test ARN. The failure path (a refund Cashfree rejects, the admin
retry) has so far run only against the fake Cashfree in
`be/test/cashfree-refunds.ts`.

## What already existed

- `Refund` rows (one per booking, `bookingId` unique), status
  `REFUND_PENDING -> REFUNDED | FAILED`, separate from the booking's status.
- Five places open one, always inside the transaction that decides it:

  | Source | `policy` | Amount |
  |---|---|---|
  | Driver cancels (booking-cancellation) | `FULL` / `LATE` | all paid / 50% of parking (config/pricing.ts) |
  | Paid after the hold lapsed and the hours were taken | `HOLD_LAPSED` | all paid |
  | Paid after the driver cancelled | `CANCELLED_BEFORE_PAYMENT` | all paid |
  | Paid after the stay ended | `PAID_AFTER_STAY` | all paid |
  | Support upholds a problem report | `PROBLEM_REPORT` | all paid |

- Nothing sent them to Cashfree. That is this feature.

## Owner decisions (2026-10-01)

- Partial refunds are shared **proportionally** (host 90 / GatePass 10), sent
  as explicit `refund_splits` so a Cashfree account setting can't change it.
  This is also Cashfree's default and the host earnings formula
  (`host-operations.earningOf`: host keeps 90% of what isn't refunded).
- A refund Cashfree fails: the driver is told, and an **admin can retry it,
  at most 3 attempts** in all.
- Refund speed **STANDARD**.
- Cancelling while a payment is open: **ask Cashfree first**. Paid -> the
  booking is confirmed and the real policy applies; payment still in
  progress -> 409 "try again in a minute"; not paid -> cancel, nothing to refund.

## Requirements (EARS)

- When a Refund row is committed, the system shall send it to Cashfree
  (`POST /orders/{order_id}/refunds`) once the transaction has committed,
  never inside it.
- If the send gets no answer or a 5xx, the system shall retry it from the
  60-second job with backoff, at most 5 sends per attempt; then mark it FAILED.
- The system shall never create two Cashfree refunds for one attempt: the
  `refund_id` is derived from the row, so a repeat is refused by Cashfree
  (409) and the existing refund is read back instead.
- When Cashfree accepts a refund, the system shall keep it REFUND_PENDING
  until Cashfree reports SUCCESS (webhook or Get Refund), then REFUNDED with
  `processedAt`; CANCELLED / REJECTED -> FAILED with the reason.
- When a refund webhook arrives, the system shall verify its signature, read
  only the ids, and ask Cashfree (`GET /orders/{order_id}/refunds/{refund_id}`)
  for the status.
- While a refund is pending, the system shall re-check it with Get Refund
  from the job (every 10 min) and when its driver opens the booking
  (at most every 2 min) -- reconciliation without the webhook.
- When an admin retries a FAILED refund (attempt < 3), the system shall first
  make sure the previous refund_id didn't in fact go through, then send a new
  attempt with a new refund_id.

## Architecture

### [Backend]
- `integrations/payment/provider.ts`: `createRefund`, `getRefund`,
  `GatewayRefund`, notice kind `REFUND`.
- `integrations/payment/cashfree/`: request/response schemas, mapping of
  Cashfree statuses, `REFUND_STATUS_WEBHOOK` parsing (ids only).
- `services/refund.service.ts` (new): `sendRefund`, `refreshRefund`,
  `onRefundNotice`, `runRefundJobs`, `retryFailedRefund`, `listForAdmin`.
- Callers after commit: booking-cancellation, payment-confirmation
  (`openRefund`), problem.service.
- `payment-confirmation.settleBeforeCancel`: the forced payment check.
- Routes: `GET /admin/refunds?status=`, `POST /admin/refunds/:id/retry`.
  No new driver route: `POST /bookings/:id/cancel` stays; the booking the app
  reads carries `refund { amount, status, policy, reference, processedAt }`.

### Data (`Refund`, migration 0020 edited in place, dev workflow)
| Column | Meaning |
|---|---|
| `gatewayRefundId` (unique) | our `refund_id` for the current attempt: `rf` + row id hex (+ `a2`, `a3`) |
| `gatewayRefundRef` | Cashfree `cf_refund_id` |
| `reference` | bank reference (`refund_arn`), shown to the driver once refunded |
| `splitAmount` | the host's part of this refund, fixed on first send |
| `attempt` | 1..3, admin retries |
| `sendTries` | sends of the current attempt without a Cashfree answer (max 5) |
| `submittedAt` | Cashfree accepted it |
| `checkedAt` | last send / status check (claims + backoff) |
| `failureReason` | why FAILED, in Cashfree's words or ours |

Payment stays `CAPTURED`; the Refund row is the refund's state.

### Reconciliation trail
`Booking.id` -> `Payment.gatewayOrderId` (Cashfree order_id), `gatewayPaymentId`
(cf_payment_id) -> `Refund.gatewayRefundId` (refund_id), `gatewayRefundRef`
(cf_refund_id), `reference` (ARN). Audit events: `REFUND_SUBMITTED`,
`REFUND_SEND_FAILED`, `REFUND_REFUNDED`, `REFUND_FAILED`, `REFUND_RETRIED`,
`REFUND_WEBHOOK_UNMATCHED`.

### Easy Split
Cashfree debits the vendor's balance for its part of a refund; after the
vendor was already paid out, the debit is taken from the next payout (Easy
Split FAQ, "Handling PG Refunds in Easy Split"). GatePass never moves host
money itself. `refund_splits: [{ vendor_id, amount: refund x splitAmount / paid }]`.

### [Frontend]
- Booking timeline: pending / refunded (with date) / failed ("our team is
  retrying it"). No Cashfree ids shown; the ARN only once refunded.

### [Security]
- Driver routes unchanged: JWT, owner in every WHERE, amount only ever from
  the server's policy. Admin routes behind `requireAdmin`.
- Webhook: HMAC over the raw body (existing), body never trusted for status.
- Secrets only in `be/.env`; the client never logs headers; errors to the app
  are clean messages.
- Concurrency: cancel is one conditional update + unique `Refund.bookingId`;
  sends are claimed with a conditional update on `checkedAt`; status moves are
  conditional on `REFUND_PENDING`; Cashfree refuses a reused `refund_id`.

## Manual Cashfree configuration
- Dashboard -> Developers -> Webhooks: the refund webhook
  (`REFUND_STATUS_WEBHOOK`) points at `<public API>/webhooks/cashfree`.
  (Create Refund has no per-refund notify_url.) Added in the sandbox dashboard
  on 2026-10-03.
- In development `<public API>` is a Cloudflare quick tunnel
  (`npm run tunnel -w be`), whose address changes on every start: the endpoint
  in the dashboard has to be edited each time, along with `WEBHOOK_PUBLIC_URL`
  in `be/.env`. While it is stale the job's Get Refund polling reconciles.
