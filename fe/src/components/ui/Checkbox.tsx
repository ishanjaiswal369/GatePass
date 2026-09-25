import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, HIT_SLOP_MIN, radius, space, type } from "@/theme";
import { CheckIcon } from "./Icon";

/**
 * A consent tick with its statement beside it.
 *
 * The whole row is the target, and the box is square rather than round so it
 * does not read as one of a set of mutually exclusive options.
 */
export function Checkbox({
  label,
  checked,
  onChange,
  children,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Extra detail under the statement, e.g. a link to the terms. */
  children?: ReactNode;
}) {
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      // react-native-web 0.19 reads aria-*, not accessibilityState.
      aria-checked={checked}
      hitSlop={8}
      style={s.row}
    >
      <View style={[s.box, checked && s.boxOn]}>
        {checked ? <CheckIcon color={colors.onInk} size={14} /> : null}
      </View>

      <View style={s.copy}>
        <Text style={s.label}>{label}</Text>
        {children}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", gap: space.md, minHeight: HIT_SLOP_MIN },
  box: {
    width: 22,
    height: 22,
    marginTop: 1,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  boxOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  copy: { flex: 1, gap: 4 },
  label: { fontSize: 14, lineHeight: 20, color: colors.ink },
});
