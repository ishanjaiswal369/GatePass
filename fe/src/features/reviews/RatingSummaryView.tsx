import { StyleSheet, Text, View } from "react-native";
import { Stars } from "@/components/ui";
import { colors, radius, space } from "@/theme";
import type { RatingSummary } from "@/types/api.types";
import { reviewCountLabel, SUB_RATINGS } from "./labels";

/**
 * A spot's rating at a glance: the average, how many it rests on, how the
 * stars spread, and the three sub-ratings -- each averaged over only the
 * drivers who answered it, so a question most people skipped doesn't read as
 * a bad score.
 */
export function RatingSummaryView({ summary }: { summary: RatingSummary }) {
  if (summary.average === null || summary.count === 0) return null;

  return (
    <View style={s.wrap}>
      <View style={s.top}>
        <View style={s.score}>
          <Text style={s.average}>{summary.average.toFixed(1)}</Text>
          <Stars value={summary.average} size={15} />
          <Text style={s.count}>{reviewCountLabel(summary.count)}</Text>
        </View>

        <View style={s.bars}>
          {summary.breakdown.map((row) => (
            <View
              key={row.stars}
              style={s.barRow}
              accessible
              accessibilityLabel={`${row.stars} stars: ${reviewCountLabel(row.count)}`}
            >
              <Text style={s.barLabel}>{row.stars}</Text>
              <View style={s.track}>
                <View style={[s.fill, { width: `${(row.count / summary.count) * 100}%` }]} />
              </View>
              <Text style={s.barCount}>{row.count}</Text>
            </View>
          ))}
        </View>
      </View>

      {SUB_RATINGS.some(({ key }) => summary.subRatings[key].count > 0) ? (
        <View style={s.subs}>
          {SUB_RATINGS.map(({ key, label }) => {
            const sub = summary.subRatings[key];
            if (sub.average === null || sub.count === 0) return null;
            return (
              <View key={key} style={s.sub}>
                <Text style={s.subValue}>{sub.average.toFixed(1)}</Text>
                <Text style={s.subLabel}>{label}</Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: space.md },
  top: { flexDirection: "row", gap: space.lg, alignItems: "center" },
  score: { alignItems: "center", gap: 4, minWidth: 92 },
  average: { fontSize: 36, fontWeight: "800", color: colors.ink, lineHeight: 40 },
  count: { fontSize: 12, color: colors.inkMuted },
  bars: { flex: 1, gap: 4 },
  barRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  barLabel: { width: 10, fontSize: 12, fontWeight: "600", color: colors.inkMuted, textAlign: "right" },
  track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.canvas, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.star },
  barCount: { width: 22, fontSize: 12, color: colors.inkMuted },
  subs: { flexDirection: "row", gap: space.sm },
  sub: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    alignItems: "center",
    gap: 2,
  },
  subValue: { fontSize: 16, fontWeight: "700", color: colors.ink },
  subLabel: { fontSize: 12, color: colors.inkMuted },
});
