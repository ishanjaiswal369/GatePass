import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, HIT_SLOP_MIN, space } from "@/theme";
import { ChevronRightIcon } from "./Icon";

/**
 * A row in the profile hub: what the section holds, and a tap to change it.
 *
 * `value` carries the current state so the hub answers "have I set this?"
 * without opening each section -- which is the whole reason the hub exists.
 */
export function SettingsRow({
  label,
  value,
  icon,
  onPress,
  last,
}: {
  label: string;
  value?: string | null;
  icon?: ReactNode;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}${value ? `, ${value}` : ""}`}
      style={[s.row, last && s.last]}
    >
      {icon ? <View style={s.icon}>{icon}</View> : null}

      <View style={s.copy}>
        <Text style={s.label}>{label}</Text>
        <Text style={[s.value, !value && s.unset]} numberOfLines={1}>
          {value || "Not set"}
        </Text>
      </View>

      <ChevronRightIcon />
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.md,
    minHeight: HIT_SLOP_MIN,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  last: { borderBottomWidth: 0 },
  icon: { width: 20, alignItems: "center" },
  copy: { flexGrow: 1, flexShrink: 1, gap: 2 },
  label: { fontSize: 15, fontWeight: "600", color: colors.ink },
  value: { fontSize: 13, color: colors.inkMuted },
  unset: { color: colors.inkFaint, fontStyle: "italic" },
});
