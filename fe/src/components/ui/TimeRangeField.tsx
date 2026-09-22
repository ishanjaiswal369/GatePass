import { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { colors, HIT_SLOP_MIN, radius, space, type } from "@/theme";

/**
 * A from/to pair of times of day, in minutes from midnight.
 *
 * Minutes rather than Date objects because that is what the hours are: a
 * window is "Tuesdays, 9 to 6", not an instant, and an instant would drag a
 * timezone into a value that has none.
 *
 * The picker is a list in a modal rather than a platform date picker.
 * `@react-native-community/datetimepicker` is a native module, so it would
 * not run on web or in Expo Go -- the same reason auth uses expo-auth-session
 * over the native Google SDK. Half-hour steps keep the list short enough to
 * scan; a host who needs 09:15 is not a case worth a keypad for.
 */

const STEP_MINUTES = 30;
const MINUTES_IN_DAY = 24 * 60;

/** 24:00 is a real end value -- it is midnight *closing*, not midnight opening. */
export function formatMinute(minute: number): string {
  if (minute >= MINUTES_IN_DAY) return "24:00";
  const hours = String(Math.floor(minute / 60)).padStart(2, "0");
  return `${hours}:${String(minute % 60).padStart(2, "0")}`;
}

function options(from: number, to: number): number[] {
  const values: number[] = [];
  for (let minute = from; minute <= to; minute += STEP_MINUTES) {
    values.push(minute);
  }
  return values;
}

export function TimeRangeField({
  startMinute,
  endMinute,
  onChange,
  label,
  disabled,
}: {
  startMinute: number;
  endMinute: number;
  onChange: (next: { startMinute: number; endMinute: number }) => void;
  /** A row label, for the per-day case. Omitted when the range stands alone. */
  label?: string;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState<"start" | "end" | null>(null);

  // An end before its start is not a window, so moving one drags the other
  // rather than letting the pair reach a state the API would refuse.
  const pick = (minute: number) => {
    if (editing === "start") {
      onChange({
        startMinute: minute,
        endMinute: Math.max(endMinute, minute + STEP_MINUTES),
      });
    } else {
      onChange({
        startMinute: Math.min(startMinute, minute - STEP_MINUTES),
        endMinute: minute,
      });
    }

    setEditing(null);
  };

  return (
    <View style={s.row}>
      {label ? <Text style={s.label}>{label}</Text> : null}

      <View style={s.fields}>
        <TimeButton
          value={startMinute}
          onPress={() => setEditing("start")}
          disabled={disabled}
          accessibilityLabel={`Opens at ${formatMinute(startMinute)}`}
        />
        <Text style={s.dash}>–</Text>
        <TimeButton
          value={endMinute}
          onPress={() => setEditing("end")}
          disabled={disabled}
          accessibilityLabel={`Closes at ${formatMinute(endMinute)}`}
        />
      </View>

      <Modal
        visible={editing !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditing(null)}
      >
        <View style={s.backdrop}>
          {/* The dismiss target is a sibling of the sheet, not its parent.
              Wrapping the sheet in it would put every option button inside a
              button, which is invalid DOM on web -- React refuses to nest
              them and the markup comes apart. It also means a tap on the
              sheet cannot reach the backdrop and close what it just opened,
              with no need to stop anything propagating. */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setEditing(null)}
            accessibilityRole="button"
            accessibilityLabel="Close"
          />

          <View style={s.sheet}>
            <Text style={s.sheetTitle}>
              {editing === "start" ? "Opens at" : "Closes at"}
            </Text>

            <ScrollView style={s.list}>
              {(editing === "start"
                ? options(0, MINUTES_IN_DAY - STEP_MINUTES)
                : options(STEP_MINUTES, MINUTES_IN_DAY)
              ).map((minute) => {
                const on =
                  minute === (editing === "start" ? startMinute : endMinute);

                return (
                  <Pressable
                    key={minute}
                    onPress={() => pick(minute)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={({ pressed }) => [
                      s.option,
                      on && s.optionOn,
                      pressed && s.optionPressed,
                    ]}
                  >
                    <Text style={[s.optionText, on && s.optionTextOn]}>
                      {formatMinute(minute)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function TimeButton({
  value,
  onPress,
  disabled,
  accessibilityLabel,
}: {
  value: number;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        s.time,
        disabled && s.timeDisabled,
        pressed && !disabled && s.timePressed,
      ]}
    >
      <Text style={s.timeText}>{formatMinute(value)}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  label: { width: 42, ...type.label, color: colors.ink },
  fields: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.sm },
  dash: { color: colors.inkFaint, fontSize: 15 },
  time: {
    flex: 1,
    minHeight: HIT_SLOP_MIN,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  timePressed: { backgroundColor: colors.canvas },
  timeDisabled: { opacity: 0.45 },
  timeText: { fontSize: 15, fontWeight: "600", color: colors.ink },
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
  sheetTitle: {
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
  },
  optionOn: { backgroundColor: colors.canvas },
  optionPressed: { backgroundColor: colors.border },
  optionText: { fontSize: 15, color: colors.ink },
  optionTextOn: { fontWeight: "700" },
});
