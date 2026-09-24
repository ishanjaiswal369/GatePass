import { StyleSheet, Text, View } from "react-native";
import { colors, radius } from "@/theme";

export type ChipTone = "success" | "warning" | "danger" | "neutral" | "ink";

const TONES: Record<ChipTone, { bg: string; fg: string }> = {
  success: { bg: "#dcfce7", fg: "#166534" },
  warning: { bg: colors.accentSurface, fg: colors.accentInk },
  danger: { bg: colors.dangerSurface, fg: "#b91c1c" },
  neutral: { bg: colors.canvas, fg: "#374151" },
  ink: { bg: colors.ink, fg: colors.onInk },
};

/**
 * A short state label: a booking's status, a refund's, a payout's.
 *
 * Tones rather than colours, so every screen says "confirmed" in the same
 * green and "under review" in the same red. The text alone carries the
 * meaning; colour only repeats it.
 */
export function StatusChip({ label, tone = "neutral" }: { label: string; tone?: ChipTone }) {
  const t = TONES[tone];
  return (
    <View style={[s.chip, { backgroundColor: t.bg }]}>
      <Text style={[s.text, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  chip: {
    alignSelf: "flex-start",
    height: 24,
    paddingHorizontal: 8,
    borderRadius: radius.sm - 2,
    justifyContent: "center",
  },
  text: { fontSize: 12, fontWeight: "700" },
});
