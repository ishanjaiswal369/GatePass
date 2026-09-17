export const colors = {
  canvas: "#f3f4f6",
  surface: "#ffffff",
  ink: "#111827",
  inkMuted: "#6b7280",
  inkFaint: "#9ca3af",
  border: "#e5e7eb",
  borderFocus: "#111827",
  primary: "#111827",
  onPrimary: "#ffffff",
  success: "#22c55e",
  danger: "#ef4444",
  dangerSurface: "#fef2f2",
  devSurface: "#fffbeb",
  devBorder: "#fcd34d",
  devInk: "#92400e",
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
} as const;

export const type = {
  title: { fontSize: 28, fontWeight: "700" },
  heading: { fontSize: 20, fontWeight: "600" },
  body: { fontSize: 15 },
  label: { fontSize: 13, fontWeight: "600" },
  caption: { fontSize: 12 },
} as const;
