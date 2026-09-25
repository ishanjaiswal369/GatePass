import { StyleSheet, Text, View } from "react-native";
import { Stars } from "@/components/ui";
import { colors, space } from "@/theme";
import type { SpotReview } from "@/types/api.types";
import { reviewMonth } from "./labels";

/** One driver's review: who, when, the stars, and what they said if anything. */
export function ReviewItem({ review }: { review: SpotReview }) {
  return (
    <View style={s.item}>
      <View style={s.head}>
        <View style={s.avatar}>
          <Text style={s.avatarText}>{review.reviewer.charAt(0)}</Text>
        </View>
        <View style={s.flex}>
          <Text style={s.name}>{review.reviewer}</Text>
          <Text style={s.when}>{reviewMonth(review.createdAt)}</Text>
        </View>
        <Stars value={review.rating} size={13} />
      </View>
      {review.comment ? <Text style={s.comment}>{review.comment}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  item: { gap: space.sm, paddingVertical: space.md, borderTopWidth: 1, borderTopColor: colors.border },
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.canvas,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 14, fontWeight: "700", color: colors.ink },
  flex: { flex: 1 },
  name: { fontSize: 14, fontWeight: "700", color: colors.ink },
  when: { fontSize: 12, color: colors.inkMuted },
  comment: { fontSize: 14, lineHeight: 21, color: "#374151" },
});
