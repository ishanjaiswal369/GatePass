import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, space } from "@/theme";
import { QrIcon } from "./Icon";

/**
 * The pass sits above discovery because a driver who is mid-booking needs the
 * QR before they need anything else on this screen.
 */
export function ActivePassCard({
  eventName,
  venueName,
  gate,
  vehicleType,
  when,
  onShowPass,
}: {
  eventName: string;
  venueName: string;
  gate: string | null;
  vehicleType: string;
  when: string;
  onShowPass: () => void;
}) {
  const detail = [venueName, gate, vehicleType].filter(Boolean).join(" · ");

  return (
    <View style={s.card}>
      <View style={s.top}>
        <Text style={s.badge}>ACTIVE PASS</Text>
        <Text style={s.when}>{when}</Text>
      </View>

      <View style={s.copy}>
        <Text style={s.name} numberOfLines={2}>
          {eventName}
        </Text>
        <Text style={s.detail} numberOfLines={1}>
          {detail}
        </Text>
      </View>

      {/* The ticket notch: a dashed tear line with the card's own background
          punched out at both edges. */}
      <View style={s.tear}>
        <View style={[s.notch, s.notchLeft]} />
        <View style={[s.notch, s.notchRight]} />
      </View>

      <Pressable onPress={onShowPass} accessibilityRole="button" style={s.action}>
        <QrIcon />
        <Text style={s.actionLabel}>Show QR pass</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.ink,
    borderRadius: radius.lg - 8,
    padding: space.lg,
    gap: space.md,
  },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  badge: {
    height: 22,
    lineHeight: 22,
    paddingHorizontal: 9,
    borderRadius: 6,
    overflow: "hidden",
    backgroundColor: colors.accent,
    color: colors.onInk,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.1,
  },
  when: { fontSize: 13, color: colors.onInkMuted },
  copy: { gap: 4 },
  name: { fontSize: 18, fontWeight: "600", color: colors.onInk, lineHeight: 23 },
  detail: { fontSize: 13, color: colors.onInkMuted },
  tear: {
    height: 1,
    marginVertical: 2,
    borderTopWidth: 1,
    borderTopColor: colors.inkRaisedBorder,
    borderStyle: "dashed",
  },
  notch: {
    position: "absolute",
    top: -7,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.surface,
  },
  notchLeft: { left: -23 },
  notchRight: { right: -23 },
  action: {
    height: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    borderRadius: 11,
    backgroundColor: colors.surface,
  },
  actionLabel: { fontSize: 14, fontWeight: "600", color: colors.ink },
});
