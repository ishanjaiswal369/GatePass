import { Pressable, StyleSheet, View } from "react-native";
import { StarIcon } from "@/components/ui";
import { HIT_SLOP_MIN } from "@/theme";

/**
 * Five stars to tap. Each star is its own radio button with a full-size touch
 * target, so a driver with a thumb and a screen reader user both get five
 * distinct choices rather than a slider.
 */
export function StarInput({
  value,
  onChange,
  size = 36,
  label,
}: {
  value: number | null;
  onChange: (value: number) => void;
  size?: number;
  /** What is being rated, for the screen reader: "Overall", "Easy to find". */
  label: string;
}) {
  return (
    <View style={s.row} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          onPress={() => onChange(n)}
          accessibilityRole="radio"
          accessibilityState={{ checked: value === n }}
          accessibilityLabel={`${label}: ${n} ${n === 1 ? "star" : "stars"}`}
          style={[s.star, { minWidth: Math.max(size, HIT_SLOP_MIN), minHeight: Math.max(size, HIT_SLOP_MIN) }]}
        >
          <StarIcon size={size} filled={value !== null && n <= value} />
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  star: { alignItems: "center", justifyContent: "center" },
});
