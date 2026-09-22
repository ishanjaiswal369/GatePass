import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, HIT_SLOP_MIN, radius, space, type } from "@/theme";
import { ChevronRightIcon } from "./Icon";
import { OptionSheet, type SheetOption } from "./OptionSheet";

/**
 * A value picked from a list, shown as a button that opens the list.
 *
 * `Field` is for what a driver types; this is for what they choose from a
 * fixed set -- a date, a time, how long for. Same box and border as `Field`
 * so a form mixing the two reads as one form.
 */
export function PickerField<T extends string | number>({
  label,
  title,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  /** The sheet's heading. Defaults to the field's own label. */
  title?: string;
  value: T;
  options: SheetOption<T>[];
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);

  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>

      <Pressable
        onPress={() => setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? "not set"}`}
        style={({ pressed }) => [
          s.box,
          disabled && s.boxDisabled,
          pressed && !disabled && s.boxPressed,
        ]}
      >
        <Text style={s.value} numberOfLines={1}>
          {current?.label ?? "—"}
        </Text>
        <ChevronRightIcon color={colors.inkFaint} size={16} />
      </Pressable>

      <OptionSheet
        title={title ?? label}
        visible={open}
        selected={value}
        options={options}
        onPick={(next) => {
          onChange(next);
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  field: { flex: 1, gap: 7 },
  label: { ...type.label, color: colors.ink },
  box: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
    minHeight: HIT_SLOP_MIN,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  boxPressed: { backgroundColor: colors.canvas },
  boxDisabled: { opacity: 0.45 },
  value: { flexShrink: 1, fontSize: 15, fontWeight: "600", color: colors.ink },
});
