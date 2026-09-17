import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, HIT_SLOP_MIN, radius, space, type } from "@/theme";

export function Button({
  label,
  onPress,
  busy,
  disabled,
  variant = "primary",
  size = "md",
  icon,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  variant?: "primary" | "ghost";
  size?: "md" | "lg";
  /** Trailing glyph. Hidden while busy so the row does not jump. */
  icon?: ReactNode;
}) {
  const inactive = disabled || busy;
  const ghost = variant === "ghost";

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!busy }}
      style={({ pressed }) => [
        s.button,
        size === "lg" && s.lg,
        ghost && s.ghost,
        inactive && s.disabled,
        pressed && !inactive && s.pressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={ghost ? colors.ink : colors.onPrimary} />
      ) : (
        <>
          <Text
            style={[s.label, size === "lg" && s.labelLg, ghost && s.labelGhost]}
          >
            {label}
          </Text>
          {icon ? <View style={s.icon}>{icon}</View> : null}
        </>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    minHeight: HIT_SLOP_MIN + 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    paddingHorizontal: space.lg,
  },
  lg: { minHeight: 52 },
  ghost: { backgroundColor: "transparent" },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.45 },
  label: { ...type.label, fontSize: 15, color: colors.onPrimary },
  labelLg: { fontSize: 16 },
  labelGhost: { color: colors.inkMuted },
  icon: { flexShrink: 0 },
});
