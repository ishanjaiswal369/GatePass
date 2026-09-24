import { Pressable, StyleSheet, Text, View } from "react-native";
import { VEHICLE_TYPES, type VehicleType } from "@/constants/enums";
import { formatRupees, hourlyAmount } from "@/lib/money";
import { formatDuration } from "@/lib/searchCriteria";
import { colors, radius, space } from "@/theme";
import type { SpaceType } from "@/types/api.types";
import { ClockIcon, PinIcon } from "./Icon";
import { SpotCover } from "./SpotCover";

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

const SPACE_LABELS: Record<SpaceType, string> = {
  DRIVEWAY: "Driveway",
  GARAGE: "Garage",
  CAR_PARK: "Car park bay",
};

/**
 * One host spot in a search result, photo first.
 *
 * A driver choosing somebody's driveway decides mostly by looking at it, so
 * the photo leads and everything else is read against it: what kind of space,
 * how far, until when, which vehicles, and what this stay will cost.
 *
 * A spot with no photo, or one whose photo fails to load, gets SpotCover's
 * ink panel rather than a grey hole.
 *
 * The rating slot says "New" because nothing is rated yet: reviews are not
 * built. Inventing stars would be the one thing worse than showing none.
 *
 * The price is the cheapest of the spot's rates, so it carries "from" whenever
 * there is more than one -- otherwise a car-and-bike spot shows its bike rate
 * to a car driver who will be charged the car one at checkout.
 */
export function SpotListItem({
  name,
  city,
  spaceType,
  coverPhotoUrl,
  distanceKm,
  pricePerHour,
  vehicleTypes,
  availableUntilMinute,
  stayMinutes,
  onPress,
}: {
  name: string;
  city: string;
  spaceType: SpaceType | null;
  coverPhotoUrl: string | null;
  distanceKm: number;
  pricePerHour: number;
  vehicleTypes: VehicleType[];
  availableUntilMinute: number;
  /** The stay being searched for, when there is one, to price it in full. */
  stayMinutes?: number;
  onPress: () => void;
}) {
  // In the app's own order (car first), not the database's alphabetical one.
  const vehicles = [...vehicleTypes]
    .sort((a, b) => VEHICLE_TYPES.indexOf(a) - VEHICLE_TYPES.indexOf(b))
    .map((kind) => VEHICLE_LABELS[kind] ?? kind);

  const from = vehicleTypes.length > 1 ? "from " : "";
  const total =
    stayMinutes !== undefined ? hourlyAmount(pricePerHour, stayMinutes) : null;
  const spaceLabel = spaceType ? SPACE_LABELS[spaceType] : "Parking space";

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${spaceLabel}, ${distanceKm.toFixed(1)} kilometres away, ${from}${formatRupees(pricePerHour)} per hour`}
      style={({ pressed }) => [s.card, pressed && s.pressed]}
    >
      <SpotCover url={coverPhotoUrl}>
        <View style={s.distancePill}>
          <PinIcon size={13} color={colors.onInk} />
          <Text style={s.distanceText}>{distanceKm.toFixed(1)} km away</Text>
        </View>
      </SpotCover>

      <View style={s.body}>
        <View style={s.titleRow}>
          <Text style={s.name} numberOfLines={1}>
            {name}
          </Text>
          <View
            style={s.rating}
            accessible
            accessibilityLabel="No reviews yet"
          >
            <Text style={s.ratingText}>New</Text>
          </View>
        </View>

        <Text style={s.meta} numberOfLines={1}>
          {spaceLabel} · {city}
        </Text>

        <View style={s.facts}>
          <View style={s.fact}>
            <ClockIcon size={14} color={colors.inkMuted} />
            <Text style={s.factText}>Open until {formatUntil(availableUntilMinute)}</Text>
          </View>
          {vehicles.map((label) => (
            <Text key={label} style={s.chip}>
              {label}
            </Text>
          ))}
        </View>

        <View style={s.divider} />

        <View style={s.priceRow}>
          <View style={s.priceBlock}>
            <Text style={s.price}>
              {from ? <Text style={s.priceFrom}>from </Text> : null}
              {formatRupees(pricePerHour)}
              <Text style={s.priceUnit}> / hour</Text>
            </Text>
          </View>

          {total !== null && stayMinutes !== undefined ? (
            <Text style={s.total}>
              {from}
              {formatRupees(total)} for {formatDuration(stayMinutes)}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  pressed: { opacity: 0.92 },
  distancePill: {
    position: "absolute",
    top: space.md,
    left: space.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: "rgba(17, 24, 39, 0.82)",
  },
  distanceText: { fontSize: 12, fontWeight: "700", color: colors.onInk },
  body: { padding: 14, gap: 6 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  name: {
    flexShrink: 1,
    flexGrow: 1,
    fontSize: 16,
    fontWeight: "600",
    color: colors.ink,
  },
  rating: {
    paddingHorizontal: 8,
    height: 22,
    borderRadius: 6,
    backgroundColor: colors.canvas,
    justifyContent: "center",
  },
  ratingText: { fontSize: 11, fontWeight: "700", color: "#374151" },
  meta: { fontSize: 13, color: colors.inkMuted },
  facts: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 7,
    paddingTop: 2,
  },
  fact: { flexDirection: "row", alignItems: "center", gap: 5, marginRight: 3 },
  factText: { fontSize: 13, color: colors.inkMuted },
  // Same chip as EventListItem's plain tag.
  chip: {
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
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 6,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space.md,
  },
  priceBlock: { flexShrink: 0 },
  price: { fontSize: 17, fontWeight: "700", color: colors.ink },
  priceFrom: { fontSize: 13, fontWeight: "600", color: colors.inkMuted },
  priceUnit: { fontSize: 13, fontWeight: "500", color: colors.inkMuted },
  total: {
    flexShrink: 1,
    textAlign: "right",
    fontSize: 13,
    fontWeight: "600",
    color: colors.ink,
  },
});
