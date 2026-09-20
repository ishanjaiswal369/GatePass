import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, space, type } from "@/theme";
import { CheckIcon } from "./Icon";

/**
 * One choice in a single-select list, as a full-width card.
 *
 * A card rather than a radio row: these choices carry a line of explanation
 * each, and a 20px radio next to two lines of text gives the tap target the
 * wrong shape on a phone. The whole card is the target.
 */
export function OptionCard({
  label,
  description,
  selected,
  onPress,
  icon,
  disabled,
}: {
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  icon?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: !!disabled }}
      style={({ pressed }) => [
        s.card,
        selected && s.cardSelected,
        disabled && s.cardDisabled,
        pressed && !disabled && s.cardPressed,
      ]}
    >
      {icon ? <View style={s.icon}>{icon}</View> : null}

      <View style={s.copy}>
        <Text style={[s.label, selected && s.labelSelected]}>{label}</Text>
        {description ? <Text style={s.description}>{description}</Text> : null}
      </View>

      <View style={[s.tick, selected && s.tickOn]}>
        {selected ? <CheckIcon color={colors.onInk} size={14} /> : null}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
    minHeight: 64,
  },
  cardSelected: { borderColor: colors.borderStrong, borderWidth: 2 },
  cardPressed: { opacity: 0.7 },
  cardDisabled: { opacity: 0.45 },
  icon: { flexShrink: 0 },
  copy: { flex: 1, gap: 2 },
  label: { ...type.label, color: colors.ink, fontSize: 15 },
  labelSelected: { fontWeight: "700" },
  description: { ...type.caption, color: colors.inkMuted },
  tick: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  tickOn: { backgroundColor: colors.ink, borderColor: colors.ink },
});
