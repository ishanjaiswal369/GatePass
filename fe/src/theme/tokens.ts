/**
 * The single source of design values. Screens and components read from here;
 * no component hardcodes a hex, radius or spacing step.
 */

export const colors = {
  canvas: "#f3f4f6",
  surface: "#ffffff",
  /** A step off the surface: a quiet panel inside a white card. */
  surfaceMuted: "#f7f8f9",
  ink: "#111827",
  /** Body text that isn't the headline: explanations, secondary lines. */
  inkSoft: "#374151",
  inkMedium: "#4b5563",
  inkMuted: "#6b7280",
  inkFaint: "#9ca3af",
  onInk: "#ffffff",
  border: "#e5e7eb",
  /** A dashed or drop-zone edge: a shade firmer than `border`. */
  borderMuted: "#cbd0d8",
  borderStrong: "#111827",
  primary: "#111827",
  onPrimary: "#ffffff",

  // Success, by where it sits: `successInk` is the green that reads as text
  // (`success` itself is too light for that), on `successSurface` or the
  // paler `successTint`, edged with `successBorder`.
  success: "#22c55e",
  successStrong: "#16a34a",
  successInk: "#166534",
  successSurface: "#dcfce7",
  successTint: "#f0fdf4",
  successBorder: "#86efac",
  successBorderSoft: "#bbf7d0",

  danger: "#ef4444",
  dangerSurface: "#fef2f2",
  dangerBorder: "#fecaca",
  /** Red text on dangerSurface: `danger` itself is too light to read there. */
  dangerInk: "#b91c1c",

  /** A switch's track when it is off. */
  trackOff: "#d1d5db",
  /** Loading placeholders, and hairlines on a muted panel. */
  skeleton: "#eceef1",
  /** Behind a map before its picture arrives, and the dot for "you are here". */
  mapSurface: "#eceee8",
  mapSelf: "#2563eb",
  shadow: "#000000",
  devSurface: "#fffbeb",
  devBorder: "#fcd34d",
  devInk: "#92400e",

  // Surfaces that sit *on* the dark header: a search field and an avatar need
  // their own steps, because canvas/border are tuned for the light body.
  inkSurface: "#1b2434",
  inkBorder: "#2f3a4d",
  inkRaised: "#212c3e",
  inkRaisedBorder: "#333f54",
  onInkMuted: "#98a2b3",

  /** The one warm accent: scarcity badges and the running-stay marker. */
  accent: "#b45309",
  accentSurface: "#fdf3e7",
  accentInk: "#92400e",

  /** Rating stars, filled -- the prototype's warm accent. */
  star: "#b45309",
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 24,
  pill: 999,
} as const;

export const type = {
  title: { fontSize: 28, fontWeight: "700" },
  heading: { fontSize: 20, fontWeight: "600" },
  body: { fontSize: 15 },
  label: { fontSize: 13, fontWeight: "600" },
  caption: { fontSize: 12 },
} as const;

/** Minimum touch target. Every pressable must clear this. */
export const HIT_SLOP_MIN = 44;
