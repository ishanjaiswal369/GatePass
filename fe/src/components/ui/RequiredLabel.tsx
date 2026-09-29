import { StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import { colors } from "@/theme";

/** The small red dot after the label of something a form can't go on without. */
export function RequiredDot() {
  return <View style={s.dot} />;
}

/**
 * A label, or a group heading, marked as required.
 *
 * The dot is decoration; "required" is said in words to a screen reader, so
 * the mark is not colour alone.
 */
export function RequiredLabel({
  children,
  style,
  header,
}: {
  children: string;
  style?: StyleProp<TextStyle>;
  header?: boolean;
}) {
  return (
    <View
      style={s.row}
      accessible
      accessibilityRole={header ? "header" : "text"}
      accessibilityLabel={`${children}, required`}
    >
      <Text style={[s.text, style]}>{children}</Text>
      <RequiredDot />
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  // Lets a long question wrap inside the row instead of pushing the dot off
  // the edge of the screen.
  text: { flexShrink: 1 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.danger },
});
