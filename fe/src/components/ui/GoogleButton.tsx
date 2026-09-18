import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, HIT_SLOP_MIN, radius, space, type } from "@/theme";
import { GoogleIcon } from "./Icon";

export function GoogleButton({
  onPress,
  busy,
  disabled,
}: {
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const inactive = busy || disabled;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
      accessibilityState={{ disabled: !!inactive, busy: !!busy }}
      style={({ pressed }) => [
        s.button,
        inactive && s.disabled,
        pressed && !inactive && s.pressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={colors.ink} />
      ) : (
        <>
          <GoogleIcon />
          <Text style={s.label}>Continue with Google</Text>
        </>
      )}
    </Pressable>
  );
}

/** The "or" rule between the primary action and the Google button. */
export function OrDivider() {
  return (
    <View style={s.divider}>
      <View style={s.rule} />
      <Text style={s.or}>or</Text>
      <View style={s.rule} />
    </View>
  );
}

const s = StyleSheet.create({
  button: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: space.lg,
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.45 },
  label: { ...type.label, fontSize: 15, color: colors.ink },
  divider: { flexDirection: "row", alignItems: "center", gap: 10 },
  rule: { flexGrow: 1, height: 1, backgroundColor: colors.border },
  or: { ...type.caption, color: colors.inkFaint, minHeight: undefined },
});

export const GOOGLE_BUTTON_MIN_HEIGHT = HIT_SLOP_MIN;
