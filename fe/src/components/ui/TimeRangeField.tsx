import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, HIT_SLOP_MIN, radius, space, type } from "@/theme";
import { OptionSheet, type SheetOption } from "./OptionSheet";

/**
 * A from/to pair of times of day, in minutes from midnight.
 *
 * Minutes rather than Date objects because that is what the hours are: a
 * window is "Tuesdays, 9 to 6", not an instant, and an instant would drag a
 * timezone into a value that has none.
 */

const MINUTES_IN_DAY = 24 * 60;

/** 24:00 is a real end value -- it is midnight *closing*, not midnight opening. */
export function formatMinute(minute: number): string {
  if (minute >= MINUTES_IN_DAY) return "24:00";
  const hours = String(Math.floor(minute / 60)).padStart(2, "0");
  return `${hours}:${String(minute % 60).padStart(2, "0")}`;
}

/**
 * Times of day as picker options.
 *
 * `step` is the caller's: a host setting opening hours thinks in half hours,
 * a driver booking a slot is offered quarters. They do not have to agree --
 * the stored value is minutes either way, and a 15-minute arrival inside a
 * window that opens on the half hour is a perfectly good booking.
 */
export function minuteOptions(
  from: number,
  to: number,
  step = 30
): SheetOption<number>[] {
  const options: SheetOption<number>[] = [];
  for (let minute = from; minute <= to; minute += step) {
    options.push({ value: minute, label: formatMinute(minute) });
  }
  return options;
}

export function TimeRangeField({
  startMinute,
  endMinute,
  onChange,
  label,
  step = 30,
  disabled,
}: {
  startMinute: number;
  endMinute: number;
  onChange: (next: { startMinute: number; endMinute: number }) => void;
  /** A row label, for the per-day case. Omitted when the range stands alone. */
  label?: string;
  step?: number;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState<"start" | "end" | null>(null);

  // An end before its start is not a window, so moving one drags the other
  // rather than letting the pair reach a state the API would refuse.
  const pick = (minute: number) => {
    if (editing === "start") {
      onChange({
        startMinute: minute,
        endMinute: Math.max(endMinute, minute + step),
      });
    } else {
      onChange({
        startMinute: Math.min(startMinute, minute - step),
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

      <OptionSheet
        title={editing === "start" ? "Opens at" : "Closes at"}
        visible={editing !== null}
        selected={editing === "start" ? startMinute : endMinute}
        options={
          editing === "start"
            ? minuteOptions(0, MINUTES_IN_DAY - step, step)
            : minuteOptions(step, MINUTES_IN_DAY, step)
        }
        onPick={pick}
        onClose={() => setEditing(null)}
      />
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
});
