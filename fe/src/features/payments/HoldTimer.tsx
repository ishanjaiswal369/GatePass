import { StyleSheet, Text, View } from "react-native";
import { ClockIcon } from "@/components/ui";
import { colors, radius, space } from "@/theme";

/** Under these, the countdown warns: amber, then red. */
const WARN_MS = 2 * 60_000;
const URGENT_MS = 60_000;

/**
 * How long the held space waits for the payment. Calm grey while there is
 * time, amber at two minutes, red at one -- the colour says "hurry" before
 * the driver has read the number.
 */
export function HoldTimer({ msLeft }: { msLeft: number }) {
  const tone = msLeft <= URGENT_MS ? tones.urgent : msLeft <= WARN_MS ? tones.warn : tones.calm;
  const total = Math.ceil(msLeft / 1000);
  const clock = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;

  return (
    <View
      style={[s.pill, { backgroundColor: tone.bg }]}
      accessibilityRole="timer"
      accessibilityLabel={`Space held for ${Math.floor(total / 60)} minutes ${total % 60} seconds`}
    >
      <ClockIcon size={14} color={tone.fg} />
      <View>
        <Text style={[s.value, { color: tone.fg }]}>{clock}</Text>
        <Text style={[s.label, { color: tone.fg }]}>held for you</Text>
      </View>
    </View>
  );
}

const tones = {
  calm: { bg: colors.canvas, fg: colors.ink },
  warn: { bg: colors.accentSurface, fg: colors.accentInk },
  urgent: { bg: colors.dangerSurface, fg: colors.dangerInk },
};

const s = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  value: { fontSize: 17, fontWeight: "700", fontVariant: ["tabular-nums"], lineHeight: 20 },
  label: { fontSize: 11, fontWeight: "600" },
});
