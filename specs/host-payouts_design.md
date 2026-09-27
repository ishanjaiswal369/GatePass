# Host payouts outside the listing wizard — technical design

The payout account (Cashfree Easy Split vendor: Create / Update / Get Vendor — see
`cashfree-payments_design.md`) belongs to the **host**, not to a listing. It moves out of the
listing wizard into its own **Payouts tab** (bottom nav: Home · Bookings · Host · **Payouts** · Profile), open to every signed-in user, before anything is listed.

## Owner decisions

| Question | Decision |
|---|---|
| Can a listing be submitted for review without a payout account? | **Yes.** The admin checks the document meanwhile; the listing goes live on its own once the vendor is ACTIVE too. |
| Where is the Payouts screen reached from? | **Its own bottom-nav tab, between Host and Profile** (changed from a Host-tab card, 2026-09-26). Also linked from the Host tab card, Earnings, the listing status screen and the review step. |
| Can someone set up payouts before listing? | **Yes.** `GET/POST /host/payout-account` need only a signed-in user; submitting creates the host profile (the vendor id is derived from it). Reading creates nothing. |

## Flow

```
Listing wizard, 9 steps (no "Getting paid")
  → Submit for review            (payout no longer required)
  → admin approves the document  → "Approved — add your payout account to go live"
  → Payouts tab (/payouts) → Create Vendor / Update Vendor
  → vendor ACTIVE + document approved → published automatically (setStatus → publishIfReady, unchanged)
```

## Changes

| Layer | Change |
|---|---|
| **BE** `spot-listing.service.readiness` | Drops the payout item, so submit no longer needs it. |
| **BE** `LISTING_SECTIONS` | Drops `payout`: an admin can't reject a listing into a step that no longer exists. |
| **BE** `admin-spot.service.approve` | The "documents approved" notification says what's missing: add a payout account (none yet), fix it (rejected), or wait (being verified). |
| **FE** `WIZARD_STEPS` | 10 → 9 (`payout` removed); `documents` continues to `review`. `app/host/spot/payout.tsx` is deleted. |
| **FE** `app/payouts.tsx` (new tab) | The payout form and status as a tab screen (large title + BottomNav, like Host); Submit in the form. After the first submit the session's `hasHostProfile` flips to true. |
| **BE** `/host/payout-account` | `authenticate` only (was `requireHost`): `getStatusForUser` returns an empty NOT_STARTED account without a profile; `submitForUser` runs `ensureProfile` first. A suspended profile is still refused (403). |
| **FE** Host tab | `PayoutCard` is always shown and opens `/payouts`: a call to action while not active, a compact "Bank account •• 1191 · Verified" once active. The "Approved" line on a spot says what the payout account needs. |
| **FE** review step | "Getting paid" becomes an info row linking to Payouts, not a blocker. |
| **FE** status screen | Approved / under review shows the payout state with an "Add payout account" / "Fix payout details" button. |
| **FE** listing dashboard | A live listing whose host's payout account stops being active shows a warning (it's out of search until fixed). |
| **FE** Earnings | "Payout account" row links to `/payouts`. |

## Security

Nothing new is exposed: the Payouts screen reads the same masked `GET /host/payout-account`
(PAN `ABCDE****F`, account last 4) and posts the same zod-strict body. The routes now need only a
signed-in user, but everything is keyed by the session's user id -- a user reads and writes only their
own host profile, which submit creates if missing; a suspended profile is still refused. Removing the payout gate from submit doesn't loosen publication: a listing still
needs `docApprovedAt` **and** `payoutKycStatus = ACTIVATED`, and search still requires ACTIVATED.

## Acceptance criteria

1. The wizard reads "1 of 9" … "9 of 9"; Continue on *Proof & permission* opens Review.
2. A host with no payout account can submit; the readiness list has no payout item.
3. The Host tab always shows the payout card; it opens `/payouts`.
4. Submitting on `/payouts` creates / updates the vendor exactly as before; ACTIVE publishes an approved listing.
5. An approved listing with no payout account shows "Add your payout account to go live" on the Host tab and its status screen, with a button to Payouts.
