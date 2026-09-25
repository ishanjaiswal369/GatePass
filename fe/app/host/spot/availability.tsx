import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { spotListingApi } from "@/api";
import {
  OptionCard,
  RestoringScreen,
  TimeRangeField,
  WizardShell,
  formatMinute,
} from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { useWizardBack } from "@/hooks/useWizardBack";
import { continueAfter } from "@/lib/wizardFlow";
import { TOTAL_STEPS, firstStepPath, nextStepPath, stepNumber } from "@/constants/wizard";
import { colors, radius, space, type } from "@/theme";

/**
 * Step 4. When the space is free, and between what hours.
 *
 * Days and hours are asked separately because hosts think of them separately:
 * "weekdays" is a different decision from "9 to 6", and a grid of 7 × 24 asks
 * them to answer both at once. Presets cover the two common shapes of week;
 * Custom is the same data with the days picked by hand.
 *
 * Hours default to one range across every chosen day, which is what most
 * spots are. "Different hours on some days" opens a row per day for the
 * garage that is free all Sunday but only evenings midweek -- the API has
 * always stored per-day windows, this is the screen catching up with it.
 */

const DAYS = [
  { value: 0, label: "Sun", long: "Sunday" },
  { value: 1, label: "Mon", long: "Monday" },
  { value: 2, label: "Tue", long: "Tuesday" },
  { value: 3, label: "Wed", long: "Wednesday" },
  { value: 4, label: "Thu", long: "Thursday" },
  { value: 5, label: "Fri", long: "Friday" },
  { value: 6, label: "Sat", long: "Saturday" },
];

const ALL_DAYS = DAYS.map((day) => day.value);
const WORKING_WEEK = [1, 2, 3, 4, 5];

const MINUTES_IN_DAY = 24 * 60;
const ALL_DAY = { startMinute: 0, endMinute: MINUTES_IN_DAY };
const DEFAULT_HOURS = { startMinute: 9 * 60, endMinute: 18 * 60 };

type Preset = "always" | "working" | "custom";
type Hours = { startMinute: number; endMinute: number };

const sameHours = (a: Hours, b: Hours) =>
  a.startMinute === b.startMinute && a.endMinute === b.endMinute;

const isAllDay = (hours: Hours) => sameHours(hours, ALL_DAY);

function presetFor(days: number[]): Preset {
  if (days.length === 7) return "always";
  if (days.join() === WORKING_WEEK.join()) return "working";
  return "custom";
}

export default function AvailabilityScreen() {
  const { spot, loading, isRestoring, token } = useSpotDraft();
  const back = useWizardBack("availability", spot?.id);

  const [preset, setPreset] = useState<Preset>("always");
  const [days, setDays] = useState<number[]>(ALL_DAYS);
  const [shared, setShared] = useState<Hours>(ALL_DAY);
  const [perDay, setPerDay] = useState(false);
  const [dayHours, setDayHours] = useState<Record<number, Hours>>({});

  /**
   * Rebuilds the controls from what the server holds.
   *
   * One window per day is what this screen can express, so a spot whose
   * windows were set elsewhere (two on one day, say) reads back as its first
   * window for that day. Saving then replaces the lot -- which is what the
   * PUT does anyway, and why the screen has to show the truth it is about to
   * overwrite rather than a blank default.
   */
  useEffect(() => {
    const windows = spot?.availability?.filter((window) => window.isActive) ?? [];
    if (windows.length === 0) return;

    const byDay: Record<number, Hours> = {};
    for (const window of windows) {
      if (byDay[window.dayOfWeek]) continue;
      byDay[window.dayOfWeek] = {
        startMinute: window.startMinute,
        endMinute: window.endMinute,
      };
    }

    const active = Object.keys(byDay).map(Number).sort((a, b) => a - b);
    const first = byDay[active[0]];
    const uniform = active.every((day) => sameHours(byDay[day], first));

    setDays(active);
    setPreset(presetFor(active));
    setShared(uniform ? first : DEFAULT_HOURS);
    setPerDay(!uniform);
    setDayHours(byDay);
  }, [spot]);

  const choose = (next: Preset) => {
    setPreset(next);
    if (next === "always") setDays(ALL_DAYS);
    if (next === "working") setDays(WORKING_WEEK);
  };

  const toggleDay = (day: number) => {
    const next = days.includes(day)
      ? days.filter((value) => value !== day)
      : [...days, day].sort((a, b) => a - b);

    setDays(next);
    setPreset(presetFor(next));
  };

  const hoursFor = (day: number): Hours => dayHours[day] ?? shared;

  const setHoursFor = (day: number, hours: Hours) =>
    setDayHours((current) => ({ ...current, [day]: hours }));

  /**
   * Per-day rows start from the range currently on screen, so turning the
   * switch on shows the hours the host is already looking at rather than a
   * default they never picked -- or, worse, values left over from the last
   * time the switch was on, which would change hours they did not touch.
   */
  const togglePerDay = (on: boolean) => {
    setPerDay(on);
    if (on) {
      setDayHours(Object.fromEntries(days.map((day) => [day, shared])));
    }
  };

  const { run: save, busy, error } = useAsyncAction(async () => {
    if (!token || !spot) return;

    await spotListingApi.saveAvailability(
      token,
      spot.id,
      days.map((dayOfWeek) => ({
        dayOfWeek,
        ...(perDay ? hoursFor(dayOfWeek) : shared),
      }))
    );

    continueAfter("availability", spot);
  });

  if (isRestoring || loading) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;
  if (!spot) return <Redirect href={firstStepPath()} />;

  return (
    <WizardShell
      title="Availability"
      sub="When can drivers book it?"
      step={stepNumber("availability")}
      totalSteps={TOTAL_STEPS}
      onBack={back}
      onContinue={save}
      canContinue={days.length > 0}
      busy={busy}
      error={error}
      footerNote={days.length === 0 ? "Pick at least one day." : undefined}
    >
      <OptionCard
        label="Every day"
        description="All seven days of the week."
        selected={preset === "always"}
        onPress={() => choose("always")}
      />
      <OptionCard
        label="Working week"
        description="Monday to Friday."
        selected={preset === "working"}
        onPress={() => choose("working")}
      />
      <OptionCard
        label="Custom"
        description="Pick the days yourself."
        selected={preset === "custom"}
        onPress={() => choose("custom")}
      />

      <View style={s.dayRow}>
        {DAYS.map((day) => {
          const on = days.includes(day.value);
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

      <View style={s.hours}>
        <Text style={s.hoursTitle}>Hours</Text>

        <View style={s.switchRow}>
          <Text style={s.switchLabel}>Open 24 hours</Text>
          <Switch
            value={!perDay && isAllDay(shared)}
            onValueChange={(on) => {
              setPerDay(false);
              setShared(on ? ALL_DAY : DEFAULT_HOURS);
            }}
            accessibilityLabel="Open 24 hours"
          />
        </View>

        {isAllDay(shared) && !perDay ? null : (
          <>
            {perDay ? (
              days.map((day) => (
                <TimeRangeField
                  key={day}
                  label={DAYS[day].label}
                  startMinute={hoursFor(day).startMinute}
                  endMinute={hoursFor(day).endMinute}
                  onChange={(hours) => setHoursFor(day, hours)}
                />
              ))
            ) : (
              <TimeRangeField
                startMinute={shared.startMinute}
                endMinute={shared.endMinute}
                onChange={setShared}
              />
            )}

            <View style={s.switchRow}>
              <Text style={s.switchLabel}>Different hours on some days</Text>
              <Switch
                value={perDay}
                onValueChange={togglePerDay}
                accessibilityLabel="Different hours on some days"
              />
            </View>
          </>
        )}
      </View>

      {days.length > 0 ? (
        <Text style={s.summary}>
          {perDay
            ? days
                .map(
                  (day) =>
                    `${DAYS[day].label} ${formatMinute(hoursFor(day).startMinute)}–${formatMinute(hoursFor(day).endMinute)}`
                )
                .join("   ")
            : `${days.map((day) => DAYS[day].label).join(", ")} · ${
                isAllDay(shared)
                  ? "open 24 hours"
                  : `${formatMinute(shared.startMinute)}–${formatMinute(shared.endMinute)}`
              }`}
        </Text>
      ) : null}

      <Text style={s.note}>
        You can switch any day off later without taking the listing down — this
        is the schedule, not a commitment.
      </Text>
    </WizardShell>
  );
}

const s = StyleSheet.create({
  dayRow: { flexDirection: "row", gap: 6, marginTop: space.sm },
  day: {
    flex: 1,
    minHeight: 46,
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
  hours: {
    gap: space.md,
    backgroundColor: colors.canvas,
    borderRadius: radius.md,
    padding: space.lg,
  },
  hoursTitle: {
    ...type.label,
    color: colors.inkMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    minHeight: 34,
  },
  switchLabel: { flex: 1, fontSize: 14, color: colors.ink },
  summary: { fontSize: 13, fontWeight: "600", color: colors.accent, lineHeight: 20 },
  note: { ...type.caption, color: colors.inkFaint, lineHeight: 18 },
});
