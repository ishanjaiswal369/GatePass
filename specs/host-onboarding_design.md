# Host onboarding v2 — technical design

Extends the existing listing wizard (`fe/app/host/spot/*`, `be/src/services/spot-listing.service.ts`).
It is not a rebuild: same routes → requests → controllers → services, same `WizardShell`
(progress bar, back, sticky Continue, footer note), same palette.

## Owner decisions (asked before design)

| Question | Decision |
|---|---|
| SUVs / vans | **Sizes of car.** One car price; the largest size that fits is stored (`maxVehicleSize`); a driver's vehicle size filters search. |
| Location before booking | **Area + approximate pin.** Society, area, city, PIN and a pin rounded to ~100 m before paying; full address, exact pin, bay and marker after. |
| Hourly rate | **Optional.** Any one of hourly / daily / monthly per vehicle type. Daily-only is charged per started day; monthly-only is only in monthly search; extra time needs an hourly rate. |
| Statuses | **Mapped to labels.** DB keeps DRAFT / PENDING_REVIEW / REJECTED / PUBLISHED / SUSPENDED. |

## Flow

| # | Step (route) | Was |
|---|---|---|
| 1 | Your space (`type`) | 3 types → 6, + short description, name rules |
| 2 | Address (`address`, `pin`) | + society / building / street / area, confirmed pin, map preview |
| 3 | Photos (`photos`) | min 2 (was 1), reorder, choose cover, suggested shots |
| 4 | **Parking details** (`details`) | new; replaces `features` + `limits` |
| 5 | Availability (`availability`) | + booking rules (min / max stay, advance) |
| 6 | Pricing (`pricing`) | per vehicle type from step 4; hourly / daily / monthly toggles |
| 7 | Getting in (`access`) | + entry method, bay number, marker |
| 8 | Proof & permission (`documents`) | + document type, owner vs permission, society/RWA, document states |
| 9 | Getting paid (`payout`) | four named states, support link |
| 10 | Review (`review`) | listing preview, Edit per section, checklist that links to steps |

After Submit: the status screen (`/host/spot?id=`) shows *Listing submitted ✓ · Under review*.

### Status labels

| DB | Condition | Host sees |
|---|---|---|
| DRAFT | | Draft |
| PENDING_REVIEW | `docApprovedAt` null | Under review |
| PENDING_REVIEW | `docApprovedAt` set | Approved — goes live when your payout account is active |
| REJECTED | | Needs changes — reason, section, action |
| PUBLISHED / ONGOING | | Live |
| SUSPENDED | | Suspended |

Going live stays automatic only when both gates are in (document approved by an admin **and** payout
ACTIVATED) — `admin-spot.publishIfReady`, unchanged.

## Requirements (EARS)

**Wizard**
- R1. The wizard shall show 10 steps, "N of 10", in the order above; every step has Back, a title, a
  subtitle, a sticky Continue that is disabled until its required fields are valid, and a footer
  message saying what is missing.
- R2. When a host continues from step 1, the system shall create a DRAFT; every later Continue saves
  to it, so leaving and returning loses nothing.
- R3. When a host opens a draft from the Host tab ("Continue your listing"), the system shall open
  the first step that still needs something, not step 1.

**Step 1 — Your space**
- R4. The host shall pick one of: Driveway, Garage, Car park bay, Private parking lot,
  Apartment / Society parking, Commercial parking; and name the listing (5–80 characters).
- R5. If the name is promotional (repeated `!`/`?`, "best", "cheapest", "#1", "no. 1", "top",
  "guaranteed", "100%", or all capitals), the system shall refuse it with an example of a good name —
  on the client and the server.
- R6. The host may add a short description (≤ 300), shown to drivers.

**Step 2 — Address**
- R7. Searching an area shall set a *tentative* pin and prefill the fields it can (street, area, city,
  state, PIN); every field stays editable.
- R8. The exact location shall be *confirmed* only on the map screen ("Save this location");
  re-searching afterwards un-confirms it. Continue needs a confirmed pin (`pinConfirmedAt`).
- R9. Required: area, city, state, 6-digit PIN, and at least one of street / society / building.
  `addressLine` is composed on the server from building, society and street.

**Step 3 — Photos**
- R10. 2–8 photos. The first is the cover; the host can add several at once, delete, move left/right
  and "Make cover". With one photo the footer says "Add at least one more photo."
- R11. A live listing shall not be saved with fewer than 2 photos (or fewer than it had, if it had one).

**Step 4 — Parking details**
- R12. Covered / Open is required (Garage prefills Covered); it is stored as the `COVERED` amenity.
- R13. Amenities: CCTV, Security, Well lit, EV charging, Gated entry, Easy access, Washroom, and
  *Other* (free text ≤ 100). "24/7 access" is not a tick box — it is derived from the hours (existing
  rule), and the screen says so.
- R14. Vehicles: Bikes / Scooters, Cars, SUVs, Vans (at least one). Cars / SUVs / Vans are one state:
  the largest car size (Small, Medium, SUV, Large). Ticking SUVs implies cars; Vans implies SUVs.
- R15. Optional: maximum height (ft), bay width and length (ft), additional details (≤ 300).
- R16. Removing a vehicle type deletes its prices in the same transaction.

**Step 5 — Availability**
- R17. As today (presets, days, Open 24 hours, per-day hours). The server refuses overlapping or
  impossible windows (existing EXCLUDE + zod).
- R18. Optional booking rules: minimum stay (1 / 2 / 4 h / custom), maximum stay (4 / 8 / 12 / 24 h /
  custom, ≥ minimum, ≤ 30 days), advance booking (7 / 14 / 30 / 60 days).
- R19. When saved hours leave out upcoming paid bookings or monthly days, the system shall say how
  many and that they still go ahead — never cancel them.
- R20. Search, quote, booking and extension shall enforce the rules: minimum and maximum stay (an
  extension counts the whole stay), and how far ahead a stay or monthly term may start.

**Step 6 — Pricing**
- R21. One section per vehicle type from step 4, each with Hourly / Daily / Monthly switches;
  each vehicle type needs at least one rate. Rates are whole rupees, 1–1,00,000.
- R22. Rates without an hourly price: daily-only stays are charged per started day; a type with only
  a monthly price is left out of hourly search and quotes ("This space is only rented monthly").
- R23. The screen says new prices apply to new bookings only.

**Step 7 — Getting in**
- R24. Entry method (Security guard, Gate code, Intercom, Manual gate, Open access, Other) and access
  instructions (≤ 1000) are required; bay number (≤ 20) and parking marker (≤ 120) are optional.
- R25. Entry gate (existing `entryPoint`) and entry method are public; instructions, bay and marker
  are released only with a paid booking or reservation.

**Step 8 — Proof & permission**
- R26. The host picks the document type (Electricity bill, Property tax receipt, Parking allotment
  document, Other property document) and uploads it (image).
- R27. The host picks *I own this space* or *I have the owner's permission*; answers whether the space
  is in a housing society / RWA-managed property; if yes, must confirm society/RWA permission.
- R28. Document states: Missing, Attached (tap to replace), Verification pending, Approved,
  Needs attention (rejection in this section) with *Fix document*.
- R29. The document is served only to its host and to admins, never through the public upload URL.

**Step 9 — Getting paid**
- R30. States: Ready to be paid (ACTIVATED), Verification pending (PENDING / UNDER_REVIEW), Needs
  attention (REJECTED → form, *Fix details*), Not configured (→ form, *Add payout account*).
  PAN, account number masked; details locked while pending; *Contact support* link.

**Step 10 — Review**
- R31. A preview: cover, name, description, type, area + city, prices per vehicle, hours, vehicles,
  amenities, access status, photo count, document status, payout status — each with *Edit* to its step.
- R32. The server returns what is missing as `{ step, message }`; the screen lists it under
  "Complete these before submitting:" and each row opens its step. Submit is disabled until empty.
- R33. Submit requires everything in R4–R30, including payout details submitted and not REJECTED.
- R34. When a rejected listing is opened, the system shall show the reason, the section it concerns
  and a button to it (admins give the section when rejecting).

**Drivers**
- R35. Before paying, drivers shall see society, area, city, PIN and a pin rounded to 3 decimals;
  never street, building, `addressLine`, bay, marker, instructions, document or permission fields.
- R36. A driver whose vehicle is larger than a space's `maxVehicleSize` shall not see it in search.

## Three perspectives

| | |
|---|---|
| **Frontend** | `WIZARD_STEPS` → 10 (drop `features`, `limits`; add `details`). New screen `details.tsx`; the rest extended in place. Shared `lib/listingRules.ts` (name check, ft↔cm, status label). Review renders server readiness items with deep links. Host tab "Continue" resumes at the first incomplete step. Dashboard links point at `details`. Spot detail / results show "Approximate location" and area; booking detail shows the exact address once paid. |
| **Backend** | New nullable columns (below). `saveType` (+ description, name rule), `saveAddress` (parts, compose line, pin confirmation), `saveDetails` (amenities, covered, vehicles, size, dims, notes; prunes pricing), `saveBookingRules`, `saveTerms` (+ entry method, bay, marker), `savePermission`, `replacePhotos` (min on live), `readiness` → items. Pricing: `pricePerHour` nullable through `stay-price`, search, quote, booking, extension, favourites. Rules enforced in search, quote, booking, extension, monthly. Public projections round coordinates and drop private fields. Admin reject takes `section`. Ownership document streamed via authenticated routes; the public upload route refuses that prefix. |
| **Security** | Every host route: `authenticate` + `requireHost`, `hostProfileId` in the WHERE (`ownedSpot`). zod `.strict()` bodies with enums, lengths, ranges. Private fields listed in R35 never selected in driver projections; exact address released only when the payment is CAPTURED. Ownership document behind owner/admin checks. Audits: `LISTING_SUBMITTED`, `OWNERSHIP_DOC_VIEWED`. |

## Data (`Listing`, all nullable / defaulted — `db push`, additions only)

| Column | Type | Public? |
|---|---|---|
| `description` | String? (≤ 300) | yes |
| `societyName` | String? (≤ 120) | yes |
| `building` | String? (≤ 60) | no — paid only |
| `street` | String? (≤ 200) | no — paid only |
| `area` | String? (≤ 120) | yes |
| `pinConfirmedAt` | DateTime? | no |
| `amenityNote` | String? (≤ 100) | yes |
| `vehicleTypes` | String[] default [] (CAR, BIKE) | yes (derived list) |
| `bayWidthCm`, `bayLengthCm` | Int? (150–1500) | yes |
| `minStayMinutes`, `maxStayMinutes` | Int? | yes |
| `advanceDays` | Int? (1–90) | yes |
| `entryMethod` | String? (enum) | yes |
| `bayNumber` | String? (≤ 20) | no — paid only |
| `parkingMarker` | String? (≤ 120) | no — paid only |
| `ownershipDocType` | String? (enum) | no |
| `permissionBasis` | String? (OWNER / OWNER_PERMISSION) | no |
| `inSociety` | Boolean? | no |
| `societyPermissionAt` | DateTime? | no |
| `rejectionSection` | String? (a wizard step) | host only |

`SpotPricing.pricePerHour` becomes `Decimal?`. Space types gain `PRIVATE_LOT`, `SOCIETY`, `COMMERCIAL`
(`CAR_PARK` now reads "Car park bay" everywhere). Amenities gain `GATED`, `EASY_ACCESS`.
Existing rows: empty `vehicleTypes` is read as "the types that have prices".

The suggested field names in the request map as: `space_type`→`spaceType`, `address`→`addressLine`,
`pincode`, `cover_photo`→photo at position 0, `parking_type`→`COVERED` amenity,
`vehicle_height_limit`→`maxVehicleHeightCm`, `availability_*`→`HostAvailability`,
`*_prices`→`SpotPricing`, `ownership_document`→`ownershipDocUrl`,
`permission_confirmation`→`permissionBasis` + `warrantyAcceptedAt` + `societyPermissionAt`,
`verification_status`→`docApprovedAt`/`status`, `payout_status`→`HostProfile.payoutKycStatus`,
`listing_status`→`status`.

## API

| Route | Change |
|---|---|
| `POST /host/spots`, `PATCH /host/spots/:id/type` | + `description`; name rule |
| `PATCH /host/spots/:id/address` | + `societyName`, `building`, `street`, `area`, `pinConfirmed` |
| `PATCH /host/spots/:id/details` | new: `covered`, `amenities`, `amenityNote`, `vehicleTypes`, `maxVehicleSize`, `maxVehicleHeightCm`, `bayWidthCm`, `bayLengthCm`, `notes` |
| `PATCH /host/spots/:id/booking-rules` | new: `minStayMinutes`, `maxStayMinutes`, `advanceDays` (null clears) |
| `PUT /host/spots/:id/availability` | response adds `outsideHours: { bookings, monthlyDays }` |
| `PATCH /host/spots/:id/pricing` | `pricePerHour` optional; ≥ 1 rate per row; rows must match `vehicleTypes` |
| `PATCH /host/spots/:id/terms` | + `entryMethod`, `bayNumber`, `parkingMarker` |
| `PATCH /host/spots/:id/permission` | new: `ownershipDocType`, `permissionBasis`, `inSociety`, `societyPermission` |
| `GET /host/spots/:id/readiness` | + `items: { step, message }[]` |
| `GET /host/spots/:id/ownership-document` | new, host-owned only; streams the file |
| `GET /admin/spots/:id/ownership-document` | new, admin only |
| `POST /admin/spots/:id/reject` | + optional `section` |
| `GET /spots/nearby` | + `vehicleSize`; rules and rounding applied |
| `PATCH /host/spots/:id/features`, `/limits` | kept for the dashboard until its links move; the wizard no longer calls them |

## Security checklist (before code)

| Check | How |
|---|---|
| Authentication | host routes behind `authenticate` + `requireHost`; admin routes `requireAdmin`; document route same |
| Authorization | `ownedSpot` / `editableSpot` / `operableSpot` put `hostProfileId` in the WHERE; another host's listing or document is 404 |
| Input validation | zod `.strict()`: enums (space type, amenity, vehicle type/size, entry method, doc type, permission basis, section); strings trimmed with max lengths; ints in ranges; PIN `^\d{6}$`; `min ≤ max` stay; name rule server-side |
| Output | driver projections (search, spot, favourites, booking/monthly before payment) omit `street`, `building`, `addressLine`, `bayNumber`, `parkingMarker`, `accessInstructions`, `ownership*`, `permission*`, `inSociety`, `rejection*`; coordinates rounded to 3 dp |
| Sensitive files | ownership documents only through the authenticated route; the public `/uploads/*` GET refuses `ownership-docs/` |
| Payout data | PAN and account number masked server-side (existing); never in driver projections |
| Integrity | pricing pruned with vehicle types in one transaction; availability replace keeps bookings; rules enforced server-side on every claim path |
| Rate limiting | `write` bucket (existing) |
| Logging | audit `LISTING_SUBMITTED`, `OWNERSHIP_DOC_VIEWED` (host or admin id, listing id) |

## Implementation plan

- [x] Schema: Listing columns, `pricePerHour` nullable; enums (space types, amenities, entry method, doc type, permission basis, sections) — `db push`, additions only
- [x] spot-listing service + requests: type/description + name rule, address parts + placed pin, details (prunes prices), booking rules, terms extras, permission, photo minimum on live listings, readiness items, availability `outsideHours`
- [x] Nullable hourly through stay-price, search, quote, booking, extension, favourites, host views
- [x] Booking rules in search, quote, booking, extension (whole stay) and the monthly start; car size in search (`vehicleSize`)
- [x] Public projections: approximate pin (3 dp) and public place only; exact address, bay and marker once paid (booking and monthly views)
- [x] Ownership document behind `GET /host/spots/:id/ownership-document` and `/admin/…`; the public upload GET refuses `ownership-docs/`; admin reject takes `section`
- [x] App: `WIZARD_STEPS` → 10, new `details` step, steps 1–3 and 5–10 extended, status screen (submitted / under review / approved / rejected), Host tab resumes at the first unfinished step, Edit from review returns to review (`useWizardContinue`), driver labels and approximate-location copy
- [x] Shared UI: `Field` names its input for screen readers and shows inline errors; `WizardShell` keeps the footer above the keyboard; `Checkbox`/`OptionCard` expose `aria-checked` on web
- [x] Live-DB suite (75 checks); earlier suites re-run (230); browser walk through all 10 steps, resume, rejection and the driver view

Routes use PATCH for step saves (the existing convention); availability stays PUT.

## Acceptance criteria

1. Progress reads 1 of 10 … 10 of 10; every step's Continue stays disabled with a footer message until valid.
2. "Best Parking in Pune!!!" is refused on both sides; "Covered parking near Kothrud Depot" is accepted.
3. A searched-but-unconfirmed pin can't continue; after "Save this location" it can.
4. One photo: Continue disabled, "Add at least one more photo."; reorder and Make cover change position 0.
5. Details: Vans ticked ⇒ size Large; unticking Bikes deletes the bike price.
6. A space with a ₹250 day rate and no hourly rate charges ₹500 for 26 hours; a monthly-only space is absent from hourly search and in monthly search.
7. Minimum 2 h: a 1-hour quote/booking is refused; maximum 8 h: an extension past 8 h total is refused; advance 7 days: a stay 10 days out is refused.
8. Changing hours around an upcoming paid booking reports it and keeps it.
9. Submit with gaps returns items with steps; the review lists them and each opens its step.
10. A driver (search, spot detail, unpaid hold) never receives street, building, bay, marker, instructions or exact coordinates; after payment the booking has the exact address, bay and marker.
11. The ownership document is 404 at its public URL and 200 at the host route for its owner, 404 for another host.
12. A rejection with section `documents` shows "Fix document" that opens step 8.

## Deliberately not built

- Private documents on a cloud bucket: the authenticated route streams from local storage; with S3 it will need a presigned GET for the `ownership-docs/` prefix.
- `problem-photos/` (Phase 4) are still served by the public upload URL; same treatment is due.
- `aria-*` state on the remaining ~30 toggles outside the wizard (tabs, filters, checkout radios): react-native-web 0.19 ignores `accessibilityState`.
- Per-photo categories (entrance, approach…): suggested as a checklist, not stored per photo.
- PDF ownership documents from the phone picker (the API accepts PDF; the app picks images).
- Automated document or bank verification: still an admin decision and the gateway's status.
- Multiple windows per day in the wizard (the API supports it; the screen edits one per day).
