import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, HIT_SLOP_MIN, radius, space, type } from "@/theme";

export interface SheetOption<T extends string | number> {
  value: T;
  label: string;
  /** A second line, for a date's weekday or a rate's caveat. */
  sub?: string;
  disabled?: boolean;
}

/**
 * A list of choices in a modal.
 *
 * A list rather than a platform picker: `@react-native-community/datetimepicker`
 * is a native module, so it would not run on web or in Expo Go -- the same
 * reason auth uses expo-auth-session over the native Google SDK. Anything this
 * app asks a driver to pick (a day, a time, a rate) is a short enough list to
 * scan.
 *
 * The dismiss target is a sibling of the sheet, not its parent. Wrapping the
 * sheet in a Pressable would put every option button inside a button, which is
 * invalid DOM on web -- React refuses to nest them and the markup comes apart.
 * It also means a tap on the sheet cannot reach the backdrop and close what it
 * just opened, with no need to stop anything propagating.
 */
export function OptionSheet<T extends string | number>({
  title,
  visible,
  options,
  selected,
  onPick,
  onClose,
}: {
  title: string;
  visible: boolean;
  options: SheetOption<T>[];
  selected?: T;
  onPick: (value: T) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={s.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />

        <View style={s.sheet}>
          <Text style={s.title}>{title}</Text>

          <ScrollView style={s.list}>
            {options.map((option) => {
              const on = option.value === selected;

              return (
                <Pressable
                  key={String(option.value)}
                  onPress={() => onPick(option.value)}
                  disabled={option.disabled}
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: on,
                    disabled: !!option.disabled,
                  }}
                  style={({ pressed }) => [
                    s.option,
                    on && s.optionOn,
                    option.disabled && s.optionDisabled,
                    pressed && !option.disabled && s.optionPressed,
                  ]}
                >
                  <Text style={[s.label, on && s.labelOn]}>{option.label}</Text>
                  {option.sub ? <Text style={s.sub}>{option.sub}</Text> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(17, 24, 39, 0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: space.xl,
  },
  sheet: {
    width: "100%",
    maxWidth: 320,
    maxHeight: "70%",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: space.md,
  },
  title: {
    ...type.label,
    color: colors.inkMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  list: { flexGrow: 0 },
  option: {
    minHeight: HIT_SLOP_MIN,
    justifyContent: "center",
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  optionOn: { backgroundColor: colors.canvas },
  optionPressed: { backgroundColor: colors.border },
  optionDisabled: { opacity: 0.4 },
  label: { fontSize: 15, color: colors.ink },
  labelOn: { fontWeight: "700" },
  sub: { ...type.caption, color: colors.inkMuted, marginTop: 1 },
});
