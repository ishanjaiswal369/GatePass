# GatePass — frontend

Expo (React Native) app for drivers. Runs on web for development, so the flow
can be driven in a browser against the local API.

```bash
npm run web      # browser, talks to http://localhost:3000
npm start        # Expo Go / device
```

`EXPO_PUBLIC_API_URL` overrides the API base; it defaults to
`http://localhost:3000`.

---

## Structure

The rule is the same one the backend follows: **the routing layer is thin, and
the work lives behind it.**

```
app/                      ROUTES ONLY — one file per screen
  _layout.tsx             providers + Stack
  index.tsx               email entry (sign up / sign in)
  verify.tsx              code entry
  profile.tsx             name capture fallback
  account.tsx             signed-in state

src/
  api/
    client.ts             the only place fetch is called; ApiError, device id
    <domain>.api.ts       endpoints for one domain (auth.api.ts, health.api.ts)
    index.ts              barrel: ApiError + authApi, healthApi namespaces
  components/
    ui/                   design system — ONE component per file
      index.ts            barrel; screens import from "@/components/ui"
  constants/
    enums.ts              mirrors be/src/constants/enums/
  hooks/                  reusable behaviour (useAsyncAction)
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

- **The session token is in memory only.** A reload signs you out, which suits
  a test harness. Persisting it needs `expo-secure-store` on native — a
  separate decision, not an oversight.
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
- **Google sign-in is in the design but not built** — there is no
  `/auth/google` endpoint yet, and a button that does nothing is worse than no
  button. Add both together.
- Designs for these screens live in `design/` at the repo root and are
  published as a canvas.
