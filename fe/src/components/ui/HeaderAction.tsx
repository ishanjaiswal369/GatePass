import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { colors, HIT_SLOP_MIN, radius, space } from "@/theme";

/**
 * A small pill for the dark header, built from the same raised-ink surface as
 * the avatar beside it so the two read as a pair. Visually 34px tall to match
 * the avatar; the touch target still clears 44px through hitSlop.
 */
export function HeaderAction({
  label,
  icon,
  onPress,
  busy,
}: {
  label: string;
  icon: ReactNode;
  onPress: () => void;
  busy?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: !!busy }}
      hitSlop={(HIT_SLOP_MIN - 34) / 2}
      style={({ pressed }) => [s.pill, pressed && s.pressed]}
    >
      {busy ? <ActivityIndicator size="small" color={colors.onInk} /> : icon}
      <Text style={s.label}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  pill: {
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.inkRaised,
    borderWidth: 1,
    borderColor: colors.inkRaisedBorder,
  },
  pressed: { opacity: 0.8 },
  label: { fontSize: 13, fontWeight: "600", color: colors.onInk },
});
