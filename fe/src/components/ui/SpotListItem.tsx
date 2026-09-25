import { Pressable, StyleSheet, Text, View } from "react-native";
import { distanceLabel as distanceText } from "@/lib/geo";
import { formatRupees } from "@/lib/money";
import { AMENITY_LABELS, spaceLabel } from "@/lib/spotLabels";
import { colors, HIT_SLOP_MIN, radius, space } from "@/theme";
import type { NearbySpot } from "@/types/api.types";
import { Button } from "./Button";
import { CheckIcon, HeartIcon, PinIcon } from "./Icon";
import { RatingBadge } from "./RatingBadge";
import { SpotCover } from "./SpotCover";

function distanceLabel(km: number): string {
  return km < 0.05 ? "Under 50 m away" : `${distanceText(km)} away`;
}

/**
 * One host spot in a search result, photo first.
 *
 * A driver picking somebody's driveway decides mostly by looking at it, so the
 * photo leads, with the distance on it. Then the few things that separate one
 * space from another -- what kind, which amenities (three at most: the card
 * is for choosing, not reading), and what this stay costs in full.
 *
 * The rating slot shows the average and how many reviews it rests on, or
 * "New" until there is one.
 */
export function SpotListItem({
  spot,
  stayLabel,
  monthly,
  months,
  selected,
  onToggleSave,
  onView,
}: {
  spot: NearbySpot;
  /** "for 7 hours" -- what `stayTotal` covers. */
  stayLabel: string;
  monthly?: boolean;
  /** Monthly: the term's length, for "₹12,000 for 3 months". */
  months?: number;
  selected?: boolean;
  onToggleSave: () => void;
  onView: () => void;
}) {
  const shown = spot.amenities.slice(0, 3);
  const extra = spot.amenities.length - shown.length;

  return (
    <View style={[s.card, selected && s.selected]}>
      <SpotCover url={spot.coverPhotoUrl} style={s.cover}>
        <View style={s.distancePill}>
          <PinIcon size={13} color={colors.onInk} />
          <Text style={s.distanceText}>{distanceLabel(spot.distanceKm)}</Text>
        </View>
        <Pressable
          onPress={onToggleSave}
          accessibilityRole="button"
          accessibilityState={{ selected: spot.saved }}
          accessibilityLabel={spot.saved ? `Remove ${spot.name} from saved` : `Save ${spot.name}`}
          style={s.heart}
        >
          <HeartIcon size={20} filled={spot.saved} />
        </Pressable>
      </SpotCover>

      <View style={s.body}>
        <View style={s.titleRow}>
          <Text style={s.name} numberOfLines={1}>
            {spot.name}
          </Text>
          <RatingBadge rating={spot.rating} count={spot.reviewCount} />
        </View>

        <Text style={s.meta} numberOfLines={1}>
          {spaceLabel(spot.spaceType)} · {spot.city}
          {spot.open24x7 ? " · Open 24/7" : ""}
        </Text>

        {shown.length > 0 ? (
          <View style={s.amenities}>
            {shown.map((amenity) => (
              <View key={amenity} style={s.amenity}>
                <CheckIcon size={13} color="#166534" />
                <Text style={s.amenityText}>{AMENITY_LABELS[amenity]}</Text>
              </View>
            ))}
            {extra > 0 ? <Text style={s.more}>+{extra} more</Text> : null}
          </View>
        ) : null}

        <View style={s.foot}>
          <View style={s.flex}>
            {monthly && spot.pricePerMonth !== null ? (
              <Text style={s.price}>
                {formatRupees(spot.pricePerMonth)}
                <Text style={s.unit}>/month</Text>
              </Text>
            ) : (
              <Text style={s.price}>
                {formatRupees(spot.pricePerHour)}
                <Text style={s.unit}>/hr</Text>
                {spot.pricePerDay !== null ? (
                  <Text style={s.unit}>
                    {" · "}
                    <Text style={s.priceSmall}>{formatRupees(spot.pricePerDay)}</Text>/day
                  </Text>
                ) : null}
              </Text>
            )}
            {monthly && months && spot.pricePerMonth !== null ? (
              <Text style={s.total}>
                {formatRupees(spot.pricePerMonth * months)} for {months} {months === 1 ? "month" : "months"}
              </Text>
            ) : null}
            {!monthly && spot.stayTotal !== null ? (
              <Text style={s.total}>
                {spot.vehicleTypes.length > 1 ? "from " : ""}
                {formatRupees(spot.stayTotal)} {stayLabel}
              </Text>
            ) : null}
          </View>
          <View style={s.view}>
            <Button label="View" variant="ghost" onPress={onView} />
          </View>
        </View>
      </View>
    </View>
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
  selected: { borderWidth: 2, borderColor: colors.ink },
  cover: { aspectRatio: 16 / 8 },
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
    backgroundColor: "rgba(17, 24, 39, 0.86)",
  },
  distanceText: { fontSize: 12, fontWeight: "700", color: colors.onInk },
  heart: {
    position: "absolute",
    top: 6,
    right: 6,
    width: HIT_SLOP_MIN,
    height: HIT_SLOP_MIN,
    borderRadius: HIT_SLOP_MIN / 2,
    backgroundColor: "rgba(255,255,255,0.94)",
    alignItems: "center",
    justifyContent: "center",
  },
  body: { padding: 14, gap: 7 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  name: { flex: 1, fontSize: 16, fontWeight: "600", color: colors.ink },
  meta: { fontSize: 13, color: colors.inkMuted },
  amenities: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  amenity: { flexDirection: "row", alignItems: "center", gap: 4 },
  amenityText: { fontSize: 13, color: "#374151" },
  more: { fontSize: 12, color: colors.inkMuted },
  foot: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
    marginTop: 2,
  },
  flex: { flex: 1, gap: 2 },
  price: { fontSize: 16, fontWeight: "700", color: colors.ink },
  priceSmall: { fontSize: 14, fontWeight: "700", color: colors.ink },
  unit: { fontSize: 13, fontWeight: "500", color: colors.inkMuted },
  total: { fontSize: 12, color: colors.inkMuted },
  view: { minWidth: 88 },
});
