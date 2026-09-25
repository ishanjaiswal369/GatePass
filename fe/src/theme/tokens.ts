/**
 * The single source of design values. Screens and components read from here;
 * no component hardcodes a hex, radius or spacing step.
 */

export const colors = {
  canvas: "#f3f4f6",
  surface: "#ffffff",
  ink: "#111827",
  inkMuted: "#6b7280",
  inkFaint: "#9ca3af",
  onInk: "#ffffff",
  border: "#e5e7eb",
  borderStrong: "#111827",
  primary: "#111827",
  onPrimary: "#ffffff",
  success: "#22c55e",
  danger: "#ef4444",
  dangerSurface: "#fef2f2",
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

  /** The one warm accent: scarcity badges and the active pass marker. */
  accent: "#b45309",
  accentSurface: "#fdf3e7",
  accentInk: "#92400e",

  /** Rating stars, filled; an empty star is `border`. */
  star: "#f59e0b",
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
