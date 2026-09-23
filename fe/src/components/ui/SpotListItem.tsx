import { Pressable, StyleSheet, Text, View } from "react-native";
import { VEHICLE_TYPES, type VehicleType } from "@/constants/enums";
import { formatRupees } from "@/lib/money";
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

const VEHICLE_LABELS: Record<VehicleType, string> = {
  CAR: "Car",
  BIKE: "Bike",
  OTHER: "Other",
};

/**
 * One host spot in a search result.
 *
 * The same anatomy as EventListItem -- ink tile, name, where, then a tag and
 * a price -- so the two kinds of parking read as one list. The tag says which
 * vehicles the spot takes, because the price alone is the cheapest rate: a
 * spot quoting "₹10/hour" for bikes would otherwise look like a bargain to a
 * car driver who is charged ₹30 at checkout. "from" appears only when there is
 * more than one rate for it to be the lowest of.
 */
export function SpotListItem({
  name,
  city,
  distanceKm,
  pricePerHour,
  vehicleTypes,
  availableUntilMinute,
  onPress,
}: {
  name: string;
  city: string;
  distanceKm: number;
  pricePerHour: number;
  vehicleTypes: VehicleType[];
  availableUntilMinute: number;
  onPress: () => void;
}) {
  // In the app's own order (car first), not the database's alphabetical one.
  const tag = [...vehicleTypes]
    .sort((a, b) => VEHICLE_TYPES.indexOf(a) - VEHICLE_TYPES.indexOf(b))
    .map((type) => VEHICLE_LABELS[type] ?? type)
    .join(" & ");
  const price = `${vehicleTypes.length > 1 ? "from " : ""}${formatRupees(pricePerHour)}/hour`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${distanceKm.toFixed(1)} kilometres away, ${price}`}
      style={({ pressed }) => [s.row, pressed && s.pressed]}
    >
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
        <View style={s.footer}>
          {tag ? <Text style={s.tag}>{tag}</Text> : null}
          <Text style={s.price}>{price}</Text>
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
    backgroundColor: colors.surface,
  },
  pressed: { backgroundColor: colors.canvas },
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
  footer: { flexDirection: "row", alignItems: "center", gap: 7 },
  // Same chip as EventListItem's plain tag.
  tag: {
    height: 20,
    lineHeight: 20,
    paddingHorizontal: 7,
    borderRadius: 5,
    overflow: "hidden",
    fontSize: 11,
    fontWeight: "700",
    backgroundColor: colors.canvas,
    color: "#374151",
  },
  price: { fontSize: 13, fontWeight: "700", color: colors.ink },
});
