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
  leadingIcon,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  /**
   * `danger` is for destructive actions (log out, delete): the card surface
   * and border of the screens around it, with the one red in the palette, so
   * it reads as part of the page and as consequential at the same time.
   */
  variant?: "primary" | "ghost" | "danger";
  size?: "md" | "lg";
  /** Trailing glyph. Hidden while busy so the row does not jump. */
  icon?: ReactNode;
  /** Glyph before the label, for actions named by an icon (log out). */
  leadingIcon?: ReactNode;
}) {
  const inactive = disabled || busy;
  const ghost = variant === "ghost";
  const danger = variant === "danger";

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
        danger && s.danger,
        inactive && s.disabled,
        pressed && !inactive && (danger ? s.dangerPressed : s.pressed),
      ]}
    >
      {busy ? (
        <ActivityIndicator
          color={danger ? colors.danger : ghost ? colors.ink : colors.onPrimary}
        />
      ) : (
        <>
          {leadingIcon ? <View style={s.icon}>{leadingIcon}</View> : null}
          <Text
            style={[
              s.label,
              size === "lg" && s.labelLg,
              ghost && s.labelGhost,
              danger && s.labelDanger,
            ]}
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
  // Same radius and border as Card, since it sits among cards.
  danger: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  pressed: { opacity: 0.85 },
  dangerPressed: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerSurface,
  },
  disabled: { opacity: 0.45 },
  label: { ...type.label, fontSize: 15, color: colors.onPrimary },
  labelLg: { fontSize: 16 },
  labelGhost: { color: colors.inkMuted },
  labelDanger: { color: colors.danger },
  icon: { flexShrink: 0 },
});
