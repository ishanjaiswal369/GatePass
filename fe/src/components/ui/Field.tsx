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
  error,
  optional,
  icon,
  focused,
  style,
  multiline,
  ...props
}: TextInputProps & {
  label: string;
  hint?: string;
  /** What's wrong with the value, inline and in red; replaces the hint while set. */
  error?: string | null;
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

      <View
        style={[
          s.box,
          multiline && s.boxMultiline,
          (focused || hasValue) && s.boxFilled,
          error ? s.boxError : null,
        ]}
      >
        {icon ? <View style={s.icon}>{icon}</View> : null}
        {/* `style` is pulled out of props and merged last rather than left in
            the spread, where it replaced this array wholesale -- a caller
            passing so much as a minHeight silently dropped the font, the
            padding, the focus reset and the flex that makes the input fill
            its box. On web that left a bare <textarea> at its intrinsic
            column width, sitting inside a full-width border. */}
        <TextInput
          multiline={multiline}
          style={[s.input, multiline && s.inputMultiline, webFocusReset, style]}
          placeholderTextColor={colors.inkFaint}
          // The visible label, as the input's name: without it a screen
          // reader announces only "text field".
          accessibilityLabel={label}
          accessibilityHint={error ?? undefined}
          {...props}
        />
      </View>

      {error ? (
        <Text style={s.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text style={s.hint}>{hint}</Text>
      ) : null}
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
  // A single-line field centres its input in the box; a text area has to fill
  // it instead, or the text sits in a band down the middle of its own border.
  boxMultiline: { alignItems: "stretch" },
  boxFilled: { borderColor: colors.borderStrong },
  icon: { flexShrink: 0 },
  input: {
    flexGrow: 1,
    flexShrink: 1,
    // Without a zero basis the web <textarea> keeps its intrinsic column
    // width and refuses to grow into the row.
    flexBasis: 0,
    fontSize: 15,
    color: colors.ink,
    paddingVertical: space.md,
  },
  inputMultiline: { width: "100%", textAlignVertical: "top" },
  hint: { ...type.caption, color: colors.inkFaint },
  boxError: { borderColor: colors.danger },
  // The darker red the app uses for text: #ef4444 is under 4.5:1 on white.
  error: { ...type.caption, color: "#b91c1c" },
});
