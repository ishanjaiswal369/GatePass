import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius } from "@/theme";

function formatUntil(minute: number) {
  // Stored end-of-day (1440) is midnight, not 12:00 AM of the same morning.
  if (minute >= 1440) return "midnight";
  const hour = Math.floor(minute / 60);
  const mins = minute % 60;
  const suffix = hour < 12 ? "AM" : "PM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(mins).padStart(2, "0")} ${suffix}`;
}

export function SpotListItem({
  name,
  city,
  distanceKm,
  pricePerHour,
  availableUntilMinute,
  onPress,
}: {
  name: string;
  city: string;
  distanceKm: number;
  pricePerHour: number;
  availableUntilMinute: number;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={s.row}>
      <View style={s.distance}>
        <Text style={s.distanceValue}>{distanceKm.toFixed(1)}</Text>
        <Text style={s.distanceUnit}>KM</Text>
      </View>

      <View style={s.body}>
        <Text style={s.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={s.meta} numberOfLines={1}>
          {city} · until {formatUntil(availableUntilMinute)}
        </Text>
        <Text style={s.price}>₹{Math.round(pricePerHour)}/hour</Text>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 13,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg - 8,
  },
  distance: {
    width: 62,
    height: 62,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  distanceValue: { fontSize: 19, fontWeight: "700", color: colors.onInk, lineHeight: 22 },
  distanceUnit: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: colors.onInkMuted,
  },
  body: { flexGrow: 1, flexShrink: 1, gap: 5 },
  name: { fontSize: 15, fontWeight: "600", color: colors.ink },
  meta: { fontSize: 13, color: "#4b5563" },
  price: { fontSize: 13, fontWeight: "700", color: colors.ink },
});
