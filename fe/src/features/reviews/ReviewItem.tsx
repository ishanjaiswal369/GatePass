import { StyleSheet, Text, View } from "react-native";
import { CheckIcon, Stars } from "@/components/ui";
import { colors, space } from "@/theme";
import type { SpotReview } from "@/types/api.types";
import { reviewAge } from "./labels";

/**
 * One driver's review: the stars and how long ago, what they said, and who.
 *
 * Every review is "Verified booking" -- only a completed, paid stay can leave
 * one (review.service) -- so the badge is a statement of the rule, not a
 * per-review flag.
 */
export function ReviewItem({ review }: { review: SpotReview }) {
  return (
    <View style={s.item}>
      <View style={s.top}>
        <Stars value={review.rating} size={14} />
        <Text style={s.when}>{reviewAge(review.createdAt)}</Text>
      </View>
      {review.comment ? <Text style={s.comment}>“{review.comment}”</Text> : null}
      <View style={s.who}>
        <View style={s.avatar}>
          <Text style={s.avatarText}>{review.reviewer.charAt(0)}</Text>
        </View>
        <Text style={s.name}>{review.reviewer}</Text>
        <View style={s.verified}>
          <CheckIcon size={12} color={GREEN} />
          <Text style={s.verifiedText}>Verified booking</Text>
        </View>
      </View>
    </View>
  );
}

const GREEN = "#166534";

const s = StyleSheet.create({
  item: { gap: space.sm, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  when: { fontSize: 12, color: colors.inkMuted },
  comment: { fontSize: 14, lineHeight: 21, color: "#374151" },
  who: { flexDirection: "row", alignItems: "center", gap: space.sm },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.canvas,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 12, fontWeight: "700", color: colors.ink },
  name: { fontSize: 13, fontWeight: "700", color: colors.ink },
  verified: { flexDirection: "row", alignItems: "center", gap: 3 },
  verifiedText: { fontSize: 12, fontWeight: "600", color: GREEN },
});
