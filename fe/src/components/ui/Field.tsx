import type { ReactNode } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type TextStyle,
} from "react-native";
import { colors, radius, space, type } from "@/theme";

/**
 * Drops the browser's default focus ring; the field's border carries focus
 * instead. Web-only, and not in React Native's style types.
 */
const webFocusReset =
  Platform.OS === "web"
    ? ({ outlineStyle: "none" } as unknown as TextStyle)
    : null;

export function Field({
  label,
  hint,
  optional,
  icon,
  focused,
  ...props
}: TextInputProps & {
  label: string;
  hint?: string;
  /** Marks the label so a blank value never reads as a mistake. */
  optional?: boolean;
  icon?: ReactNode;
  focused?: boolean;
}) {
  const hasValue = typeof props.value === "string" && props.value.length > 0;

  return (
    <View style={s.field}>
      <View style={s.labelRow}>
        <Text style={s.label}>{label}</Text>
        {optional ? <Text style={s.optional}>optional</Text> : null}
      </View>

      <View style={[s.box, (focused || hasValue) && s.boxFilled]}>
        {icon ? <View style={s.icon}>{icon}</View> : null}
        <TextInput
          style={[s.input, webFocusReset]}
          placeholderTextColor={colors.inkFaint}
          {...props}
        />
      </View>

      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  field: { gap: 7 },
  labelRow: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  label: { ...type.label, color: colors.ink },
  optional: { fontSize: 11, color: colors.inkFaint },
  box: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 13,
    minHeight: 48,
  },
  boxFilled: { borderColor: colors.borderStrong },
  icon: { flexShrink: 0 },
  input: {
    flexGrow: 1,
    flexShrink: 1,
    fontSize: 15,
    color: colors.ink,
    paddingVertical: space.md,
  },
  hint: { ...type.caption, color: colors.inkFaint },
});
