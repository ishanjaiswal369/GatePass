import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  Button,
  OptionCard,
  PickerField,
  SegmentedControl,
  type SheetOption,
  formatMinute,
  minuteOptions,
} from "@/components/ui";
import {
  EVERY_DAY,
  MAX_DAYS_AHEAD,
  MAX_STAY_DAYS,
  MIN_STAY_MINUTES,
  WEEKDAYS,
  addDays,
  atMinute,
  dayLabel,
  nextStepMinute,
  toDateKey,
  type DayPattern,
  type SearchCriteria,
  type SearchMode,
  type SearchPlace,
} from "@/lib/searchCriteria";
import { colors, radius, space, type } from "@/theme";
import { LocationField } from "./LocationField";

/**
 * What the driver is looking for.
 *
 * Two modes, because they are two different questions. Hourly asks "between
 * these two instants"; monthly asks "these weekdays, every week, from this
 * date" -- the same shape a host's availability is stored in, which is what
 * makes matching one against the other possible at all.
 *
 * Location is shared rather than duplicated per mode: it is the same question
 * either way, and asking it twice invites two answers.
 */

const MODES: { value: SearchMode; label: string }[] = [
  { value: "hourly", label: "Hourly / Daily" },
  { value: "monthly", label: "Monthly" },
];

const DAYS = [
  { value: 0, label: "Sun", long: "Sunday" },
  { value: 1, label: "Mon", long: "Monday" },
  { value: 2, label: "Tue", long: "Tuesday" },
  { value: 3, label: "Wed", long: "Wednesday" },
  { value: 4, label: "Thu", long: "Thursday" },
  { value: 5, label: "Fri", long: "Friday" },
  { value: 6, label: "Sat", long: "Saturday" },
];

/** A driver books to the quarter hour; a host sets opening hours by the half. */
const DRIVER_STEP_MINUTES = 15;

function dayOptions(count: number): SheetOption<string>[] {
  const today = new Date();

  return Array.from({ length: count }, (_, index) => {
    const date = addDays(today, index);
    return { value: toDateKey(date), label: dayLabel(date) };
  });
}

function patternFor(days: number[]): DayPattern {
  if (days.length === 7) return "everyday";
  if (days.join() === WEEKDAYS.join()) return "weekdays";
  return "custom";
}

export function BookParkingForm({
  token,
  onSearch,
}: {
  token: string | null;
  onSearch: (criteria: SearchCriteria) => void;
}) {
  const [mode, setMode] = useState<SearchMode>("hourly");
  const [place, setPlace] = useState<SearchPlace | null>(null);

  const now = useMemo(() => new Date(), []);
  const days = useMemo(() => dayOptions(MAX_DAYS_AHEAD), []);

  // Hourly. Defaults to the next quarter hour, for two hours -- the shape of
  // almost every hourly booking, so most drivers change nothing here.
  //
  // The end is derived as an instant and read back, rather than clamped to
  // the end of the day: at 23:45 clamping produced a fifteen-minute stay,
  // which is a valid booking and not remotely what was meant.
  const defaultStart = useMemo(
    () => atMinute(toDateKey(now), nextStepMinute(now, DRIVER_STEP_MINUTES)),
    [now]
  );
  const defaultEnd = useMemo(
    () => new Date(defaultStart.getTime() + 2 * 60 * 60_000),
    [defaultStart]
  );

  const [fromDate, setFromDate] = useState(toDateKey(defaultStart));
  const [fromMinute, setFromMinute] = useState(
    defaultStart.getHours() * 60 + defaultStart.getMinutes()
  );
  const [toDate, setToDate] = useState(toDateKey(defaultEnd));
  const [toMinute, setToMinute] = useState(
    defaultEnd.getHours() * 60 + defaultEnd.getMinutes()
  );

  // Monthly.
  const [monthlyDays, setMonthlyDays] = useState<number[]>(WEEKDAYS);
  const [startDate, setStartDate] = useState(toDateKey(addDays(now, 1)));
  const [startMinute, setStartMinute] = useState(9 * 60);
  const [endMinute, setEndMinute] = useState(18 * 60);

  const from = atMinute(fromDate, fromMinute);
  const to = atMinute(toDate, toMinute);
  const stayMinutes = (to.getTime() - from.getTime()) / 60_000;

  const hourlyProblem =
    stayMinutes < MIN_STAY_MINUTES
      ? `Minimum stay is ${MIN_STAY_MINUTES} minutes.`
      : stayMinutes > MAX_STAY_DAYS * 24 * 60
        ? `For longer than ${MAX_STAY_DAYS} days, try Monthly.`
        : null;

  const monthlyProblem =
    monthlyDays.length === 0
      ? "Pick at least one day."
      : startMinute >= endMinute
        ? "The end time has to be after the start."
        : null;

  const problem = mode === "hourly" ? hourlyProblem : monthlyProblem;
  const canSearch = place !== null && problem === null;

  const search = () => {
    if (!place) return;

    onSearch(
      mode === "hourly"
        ? { mode, place, from: from.toISOString(), to: to.toISOString() }
        : {
            mode,
            place,
            days: [...monthlyDays].sort((a, b) => a - b),
            startDate,
            startMinute,
            endMinute,
          }
    );
  };

  const toggleDay = (day: number) =>
    setMonthlyDays((current) =>
      current.includes(day)
        ? current.filter((value) => value !== day)
        : [...current, day].sort((a, b) => a - b)
    );

  const choosePattern = (next: DayPattern) => {
    if (next === "everyday") setMonthlyDays(EVERY_DAY);
    if (next === "weekdays") setMonthlyDays(WEEKDAYS);
  };

  const pattern = patternFor(monthlyDays);

  return (
    <View style={s.wrap}>
      <SegmentedControl segments={MODES} value={mode} onChange={setMode} />

      <View style={s.card}>
        <Text style={s.cardHeading}>Where</Text>
        <LocationField token={token} place={place} onChange={setPlace} />
      </View>

      {mode === "hourly" ? (
        <View style={s.card}>
          <Text style={s.cardHeading}>When</Text>

          <View style={s.row}>
            <PickerField
              label="Arriving"
              title="Arriving on"
              value={fromDate}
              options={days}
              onChange={(next) => {
                setFromDate(next);
                // Leaving before arriving is not a stay. The end follows the
                // start rather than being refused, which is what a driver
                // moving their booking a day later means anyway.
                if (next > toDate) setToDate(next);
              }}
            />
            <PickerField
              label="At"
              title="Arriving at"
              value={fromMinute}
              options={minuteOptions(0, 24 * 60 - DRIVER_STEP_MINUTES, DRIVER_STEP_MINUTES)}
              onChange={setFromMinute}
            />
          </View>

          <View style={s.row}>
            <PickerField
              label="Leaving"
              title="Leaving on"
              value={toDate}
              options={days.filter((day) => day.value >= fromDate)}
              onChange={setToDate}
            />
            <PickerField
              label="At"
              title="Leaving at"
              value={toMinute}
              options={minuteOptions(DRIVER_STEP_MINUTES, 24 * 60, DRIVER_STEP_MINUTES)}
              onChange={setToMinute}
            />
          </View>

          {problem ? null : <Text style={s.summary}>{describeStay(stayMinutes)}</Text>}
        </View>
      ) : (
        <View style={s.card}>
          <Text style={s.cardHeading}>Which days</Text>

          <OptionCard
            label="Every day"
            description="All seven days of the week."
            selected={pattern === "everyday"}
            onPress={() => choosePattern("everyday")}
          />
          <OptionCard
            label="Monday to Friday"
            description="The working week."
            selected={pattern === "weekdays"}
            onPress={() => choosePattern("weekdays")}
          />
          <OptionCard
            label="Custom"
            description="Pick the days yourself."
            selected={pattern === "custom"}
            onPress={() => undefined}
          />

          <View style={s.dayRow}>
            {DAYS.map((day) => {
              const on = monthlyDays.includes(day.value);
              return (
                <Pressable
                  key={day.value}
                  onPress={() => toggleDay(day.value)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={day.long}
                  style={[s.day, on && s.dayOn]}
                >
                  <Text style={[s.dayLabel, on && s.dayLabelOn]}>{day.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={s.row}>
            <PickerField
              label="Starting on"
              value={startDate}
              options={days}
              onChange={setStartDate}
            />
          </View>

          <View style={s.row}>
            <PickerField
              label="From"
              title="Each day from"
              value={startMinute}
              options={minuteOptions(0, 24 * 60 - DRIVER_STEP_MINUTES, DRIVER_STEP_MINUTES)}
              onChange={setStartMinute}
            />
            <PickerField
              label="Until"
              title="Each day until"
              value={endMinute}
              options={minuteOptions(DRIVER_STEP_MINUTES, 24 * 60, DRIVER_STEP_MINUTES)}
              onChange={setEndMinute}
            />
          </View>

          {problem ? null : (
            <Text style={s.summary}>
              {monthlyDays.length === 7
                ? "Every day"
                : monthlyDays.map((day) => DAYS[day].label).join(", ")}
              {"  ·  "}
              {formatMinute(startMinute)}–{formatMinute(endMinute)}
            </Text>
          )}
        </View>
      )}

      <Button
        label="Show parking spaces"
        size="lg"
        disabled={!canSearch}
        onPress={search}
      />

      <Text style={s.note}>
        {problem ?? (place ? " " : "Pick where you want to park to continue.")}
      </Text>
    </View>
  );
}

function describeStay(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;

  const hours = minutes / 60;
  if (hours < 24) {
    return hours % 1 === 0 ? `${hours} hours` : `${Math.floor(hours)}h ${minutes % 60}m`;
  }

  const days = Math.floor(hours / 24);
  const rest = Math.round(hours % 24);
  return rest === 0 ? `${days} days` : `${days}d ${rest}h`;
}

const s = StyleSheet.create({
  wrap: { gap: space.lg },
  card: {
    gap: space.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
  },
  cardHeading: {
    ...type.label,
    color: colors.inkMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  row: { flexDirection: "row", gap: space.md },
  dayRow: { flexDirection: "row", gap: 6 },
  day: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  dayOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  dayLabel: { fontSize: 12, fontWeight: "600", color: colors.inkMuted },
  dayLabelOn: { color: colors.onInk },
  summary: { fontSize: 13, fontWeight: "600", color: colors.accent },
  note: { ...type.caption, color: colors.inkFaint, textAlign: "center" },
});
