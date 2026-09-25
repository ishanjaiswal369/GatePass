import { StyleSheet, Text, View } from "react-native";
import { colors } from "@/theme";
import { StarIcon } from "./Icon";

/**
 * A spot's rating in the space a card has for it: ★ 4.6 (12), or "New" until
 * somebody has reviewed it. Invented stars would be worse than none, so an
 * unrated spot never shows a number.
 */
export function RatingBadge({ rating, count }: { rating: number | null; count: number }) {
  if (rating === null || count === 0) {
    return (
      <View style={s.chip} accessible accessibilityLabel="No reviews yet">
        <Text style={s.chipText}>New</Text>
      </View>
    );
  }

  return (
    <View
      style={s.rated}
      accessible
      accessibilityLabel={`Rated ${rating.toFixed(1)} out of 5 from ${count} ${count === 1 ? "review" : "reviews"}`}
    >
      <StarIcon size={14} />
      <Text style={s.value}>{rating.toFixed(1)}</Text>
      <Text style={s.count}>({count})</Text>
    </View>
  );
}

/** Five stars, the first `value` of them filled: one review's rating. */
export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <View style={s.row} accessible accessibilityLabel={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <StarIcon key={n} size={size} filled={n <= Math.round(value)} />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  chip: { paddingHorizontal: 8, height: 22, borderRadius: 6, backgroundColor: colors.canvas, justifyContent: "center" },
  chipText: { fontSize: 11, fontWeight: "700", color: "#374151" },
  rated: { flexDirection: "row", alignItems: "center", gap: 3, height: 22 },
  value: { fontSize: 13, fontWeight: "700", color: colors.ink },
  count: { fontSize: 12, color: colors.inkMuted },
  row: { flexDirection: "row", gap: 2 },
});
