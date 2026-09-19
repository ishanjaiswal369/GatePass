import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { colors, HIT_SLOP_MIN, radius, space } from "@/theme";
import { PinIcon, ShieldIcon } from "./Icon";

function BarrierGlyph() {
  return (
    <Svg width={34} height={34} viewBox="0 0 24 24" fill="none">
      <Path d="M4 3v18" stroke={colors.onInk} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M4 6.5h15" stroke={colors.onInk} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M8.5 6.5v5M13 6.5v5M17.5 6.5v5" stroke={colors.onInk} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

/**
 * The Nearby tab before permission is granted.
 *
 * Location is asked for here, on the tab that needs it, rather than on app
 * open: a cold permission prompt with no visible reason gets denied far more
 * often, and a denial is much harder to undo than a delay.
 */
export function LocationPrompt({
  onEnableLocation,
  onEnterArea,
  busy,
  note,
}: {
  onEnableLocation: () => void;
  onEnterArea: () => void;
  busy?: boolean;
  note?: string | null;
}) {
  return (
    <View style={s.wrap}>
      <View style={s.ringOuter}>
        <View style={s.ringInner}>
          <View style={s.disc}>
            <BarrierGlyph />
          </View>
        </View>
      </View>

      <View style={s.copy}>
        <Text style={s.title}>Parking spots near you</Text>
        <Text style={s.sub}>
          Turn on location and we'll show private spots people are renting out
          around you.
        </Text>
      </View>

      <View style={s.actions}>
        <Pressable
          onPress={onEnableLocation}
          disabled={busy}
          accessibilityRole="button"
          style={[s.primary, busy && s.busy]}
        >
          <PinIcon />
          <Text style={s.primaryLabel}>
            {busy ? "Finding you…" : "Enable location"}
          </Text>
        </Pressable>

        <Pressable onPress={onEnterArea} accessibilityRole="button" style={s.secondary}>
          <Text style={s.secondaryLabel}>Enter an area manually</Text>
        </Pressable>
      </View>

      {note ? <Text style={s.note}>{note}</Text> : null}

      <View style={s.reassure}>
        <ShieldIcon />
        <Text style={s.reassureText}>
          Used only to find spots around you. Nothing is shared with hosts until
          you book.
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 26,
    paddingHorizontal: 20,
  },
  ringOuter: {
    width: 168,
    height: 168,
    borderRadius: 84,
    borderWidth: 1,
    borderColor: "#eceef1",
    alignItems: "center",
    justifyContent: "center",
  },
  ringInner: {
    width: 124,
    height: 124,
    borderRadius: 62,
    backgroundColor: "#f7f8f9",
    alignItems: "center",
    justifyContent: "center",
  },
  disc: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { alignItems: "center", gap: 10 },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.ink,
    textAlign: "center",
    letterSpacing: -0.4,
  },
  sub: {
    fontSize: 15,
    color: "#4b5563",
    textAlign: "center",
    lineHeight: 23,
    maxWidth: 286,
  },
  actions: { alignSelf: "stretch", gap: space.sm },
  primary: {
    height: 52,
    minHeight: HIT_SLOP_MIN,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    borderRadius: 13,
    backgroundColor: colors.ink,
  },
  busy: { opacity: 0.6 },
  primaryLabel: { fontSize: 15, fontWeight: "600", color: colors.onPrimary },
  secondary: {
    height: 48,
    minHeight: HIT_SLOP_MIN,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryLabel: { fontSize: 14, fontWeight: "500", color: "#374151" },
  note: { fontSize: 13, color: colors.accentInk, textAlign: "center", lineHeight: 19 },
  reassure: { flexDirection: "row", gap: space.sm, maxWidth: 300 },
  reassureText: { fontSize: 13, color: colors.inkMuted, lineHeight: 20, flexShrink: 1 },
});
