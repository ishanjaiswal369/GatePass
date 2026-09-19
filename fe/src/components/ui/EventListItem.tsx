import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, space } from "@/theme";

/** Below this, the card says how few are left instead of listing vehicles. */
const SCARCITY_THRESHOLD = 10;

function formatDay(iso: string) {
  const date = new Date(iso);
  return {
    day: String(date.getDate()).padStart(2, "0"),
    month: date.toLocaleString(undefined, { month: "short" }).toUpperCase(),
    time: date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }),
  };
}

export function EventListItem({
  name,
  venueName,
  eventDate,
  minPrice,
  spotsLeft,
  vehicleTypes,
  onPress,
}: {
  name: string;
  venueName: string;
  eventDate: string;
  minPrice: number;
  spotsLeft: number;
  vehicleTypes: string[];
  onPress: () => void;
}) {
  const { day, month, time } = formatDay(eventDate);

  // Scarcity earns the warm badge; otherwise the row just says what fits.
  const scarce = spotsLeft <= SCARCITY_THRESHOLD;
  const tag = scarce
    ? `${spotsLeft} left`
    : vehicleTypes
        .map((t) => t.charAt(0) + t.slice(1).toLowerCase())
        .join(" & ");

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name} at ${venueName}, ${day} ${month}`}
      style={s.row}
    >
      <View style={s.date}>
        <Text style={s.day}>{day}</Text>
        <Text style={s.month}>{month}</Text>
      </View>

      <View style={s.body}>
        <Text style={s.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={s.venue} numberOfLines={1}>
          {venueName} · {time}
        </Text>
        <View style={s.meta}>
          <Text style={[s.tag, scarce ? s.tagScarce : s.tagPlain]}>{tag}</Text>
          <Text style={s.price}>from ₹{Math.round(minPrice)}</Text>
        </View>
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
  date: {
    width: 62,
    height: 62,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
  },
  day: { fontSize: 21, fontWeight: "700", color: colors.onInk, lineHeight: 24 },
  month: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: colors.onInkMuted,
  },
  body: { flexGrow: 1, flexShrink: 1, gap: 5 },
  name: { fontSize: 15, fontWeight: "600", color: colors.ink },
  venue: { fontSize: 13, color: "#4b5563" },
  meta: { flexDirection: "row", alignItems: "center", gap: 7 },
  tag: {
    height: 20,
    lineHeight: 20,
    paddingHorizontal: 7,
    borderRadius: 5,
    overflow: "hidden",
    fontSize: 11,
    fontWeight: "700",
  },
  tagScarce: {
    backgroundColor: colors.accentSurface,
    color: colors.accentInk,
  },
  tagPlain: { backgroundColor: colors.canvas, color: "#374151" },
  price: { fontSize: 13, fontWeight: "700", color: colors.ink },
});
