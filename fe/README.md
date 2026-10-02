# GatePass — frontend

Expo (React Native) app for drivers and hosts: search and book parking, pay
by UPI through Cashfree, manage a stay; list a space, run it, get paid. Runs
on web for development, so the flows can be driven in a browser against the
local API, and on Android as a development build.

```bash
npm run web                                # browser, talks to http://localhost:3000
npx expo start --dev-client --localhost    # the installed development build, over USB
npm run android                            # build and install it (after native changes)
```

`EXPO_PUBLIC_API_URL` overrides the API base; it defaults to
`http://localhost:3000`.

---

## Running on a real phone

Web is where the flows are driven day to day; these are the things that only
matter on a device.

1. **Bundle IDs.** `expo.android.package` is `com.gatepass.app`;
   `expo.ios.bundleIdentifier` is not set yet and has to be before the first
   iOS build. They become permanent once published.
2. **A development build, not Expo Go.** The store Expo Go app runs only the
   latest SDK; this project is on SDK 51. Use `npx expo run:android` /
   `npx expo run:ios` (Android Studio / Xcode) or an EAS development build.
3. **Reachable addresses.** `localhost` on a phone is the phone. Over USB,
   forward the ports -- `adb reverse tcp:3000 tcp:3000` (API and uploads) and
   `adb reverse tcp:8081 tcp:8081` (Metro), again after every replug -- and
   keep `EXPO_PUBLIC_API_URL` and the API's `STORAGE_PUBLIC_BASE_URL` on
   `http://127.0.0.1:3000`. Over Wi-Fi, point both at an address the phone can
   reach, e.g. `http://192.168.1.20:3000`. Photos upload to, and load from,
   the storage URL directly.
4. **HTTPS for release.** Debug builds allow `http://`; an Android *release*
   build refuses it (cleartext is enabled only in the debug manifest), and iOS
   allows it only to IP addresses. Store builds need the API on `https://`.
5. **Checked here without a device:** `npx expo export --platform ios
   --platform android` builds both Hermes bundles, and `npx expo prebuild`
   produces the expected permissions (photo library, camera text, location
   while in use; no microphone, no storage write). Tapping through on a real
   phone still has to be done on one.
6. **Store submission needs an SDK upgrade.** Google Play requires new apps
   to target Android 16 (API 36) from 31 Aug 2026 and SDK 51 targets API 34;
   the App Store requires Xcode 26 / the iOS 26 SDK from 28 Apr 2026, newer
   than SDK 51 / React Native 0.74 were built for. Upgrade the Expo SDK before
   publishing.

---

## Structure

The rule is the same one the backend follows: **the routing layer is thin, and
the work lives behind it.**

```
app/                      ROUTES ONLY — one file per screen
  _layout.tsx             providers + Stack
  index.tsx, verify.tsx, profile.tsx, password.tsx     sign in
  home.tsx                Already parked / Book parking
  parking.tsx             the stay running now
  spots/                  results, filters, a spot, its reviews, checkout
  bookings.tsx            Upcoming / Active / Past
  booking/[id]/           detail, pay, confirmed, extend, cancel, problem, review
  host.tsx, host/         dashboard, bookings, earnings, a listing and its
                          calendar, and host/spot/* -- the listing wizard
  payouts.tsx             the host's payout account
  notifications.tsx
  account.tsx, account/   profile hub: details, vehicles, address, saved,
                          payment methods, delete account
  about, terms, privacy, refund, shipping, contact     the public policy pages

src/
  api/
    client.ts             the only place fetch is called; ApiError
    <domain>.api.ts       endpoints for one domain (auth, bookings, spots,
                          payments, host, spotListing, notifications, ...)
    index.ts              barrel: ApiError + one namespace per domain
  components/
    ui/                   design system — ONE component per file
      index.ts            barrel; screens import from "@/components/ui"
  features/               blocks worth naming, by area: auth, search,
                          bookings, payments, reviews, host, legal
  constants/
    enums.ts              mirrors be/src/constants/enums/
    wizard.ts             the listing wizard's steps, in order
  hooks/                  reusable behaviour (useAsyncAction, useSpotDraft,
                          useScreenInsets, usePushNotifications, ...)
  lib/                    storage, tokenStore, deviceId, payments (the one
                          place the app takes money), money, push
  providers/              React context (SessionProvider)
  theme/
    tokens.ts             colors, space, radius, type — the only source
  types/
    api.types.ts          API response shapes
```

### How it maps to the backend

| Backend | Frontend | Role |
|---|---|---|
| `src/api.ts` | `app/**` | routing only |
| `controllers/` | the screen component | wire input → call → navigate |
| `services/` | `src/api/<domain>.api.ts` | the actual calls |
| `lib/` | `src/api/client.ts`, `src/hooks/` | plumbing |
| `constants/enums/` | `src/constants/enums.ts` | shared vocabulary |

---

## Conventions

**Imports use `@/`, never `../..`.** `@/*` maps to `src/*` (tsconfig `paths`).
Routes in `app/` import from `@/`; nothing in `src/` imports from `app/`.

**Screens hold only what is theirs.** Form state, and a `useAsyncAction` call.
No `fetch`, no `try/catch` boilerplate, no colour literals. If a screen grows a
block worth naming, it becomes a component in `src/components/`.

**No hardcoded design values.** Every colour, gap and radius comes from
`@/theme`. A raw hex in a screen is a bug.

**One component per file** in `components/ui/`, exported through the barrel.
Screens import `{ Button, Field } from "@/components/ui"` — never a deep path.

**Icons live in `Icon.tsx`** as stroke SVGs on a 24px grid. Never emoji.

**Every pressable clears 44px** (`HIT_SLOP_MIN`).

**Destructive actions use `<Button variant="danger">`** (log out, delete):
card surface and border with the palette's one red, plus a `leadingIcon`. Not
`ghost`, which reads as a secondary link rather than something with
consequences.

**API errors carry status.** `ApiError.status` lets a screen tell a 429 rate
limit from a 400 wrong code. Use `err instanceof ApiError` — `useAsyncAction`
already does this and exposes `error` as a string.

**Adding an endpoint**: add it to the right `src/api/<domain>.api.ts` using
`request()` from `client.ts`, add its response type to `src/types/api.types.ts`,
and call it through `authApi.x()` from the screen. Never call `fetch` directly.

---

## Notes

- **The session survives a reload.** The token is kept through `lib/storage`
  (`expo-secure-store` on native, `localStorage` on web) and checked against
  `/auth/me` on restore. While that is in flight `isRestoring` is true, and
  every protected screen waits for it before deciding the user is signed out.
- **Paying.** `lib/payments.ts` is the one place the app takes money: UPI is
  started by the API, which hands back links into UPI apps (or a QR on a
  desktop browser). Nothing in the app decides a booking is paid; the pay
  screen reads `CONFIRMED` from the API, which has it from Cashfree.
- **The dev code box** on the verify screen shows what the API echoes back
  while `EMAIL_PROVIDER=console`. It disappears on its own in production,
  because the API stops sending the field.
- **The splash** is one image, `assets/splash.png`, used twice: as the native
  splash in `app.json`, and by `BrandSplash`, which holds it ~2.2 s on cold
  start and then fades to the first screen. On a device the hand-off from the
  OS splash is invisible; on web `BrandSplash` is the only place it shows.
  Source and render script notes: `design/splash-philosophy.md`.
- **`PhoneFrame`** centres the app in a 390×844 shell so the browser looks like
  a phone. Screens render full-bleed inside it and own their own header.
- **Google sign-in** uses `expo-auth-session` and `POST /auth/google`. It
  needs `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (and the Android / iOS ids on
  native); without one the button is hidden in production and shown disabled
  with a hint in development.
- Designs for the sign-in screens live in `design/` at the repo root and are
  published as a canvas. The rest of the app follows the clickable prototype
  named in `specs/driver-journey_design.md`.
