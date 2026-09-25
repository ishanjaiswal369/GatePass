import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { spotListingApi } from "@/api";
import {
  ChevronDownIcon,
  Field,
  OptionCard,
  RestoringScreen,
  TimeRangeField,
  WizardShell,
  formatMinute,
} from "@/components/ui";
import { durationText } from "@/lib/listingRules";
import type { OutsideHours } from "@/types/api.types";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { useWizardBack } from "@/hooks/useWizardBack";
import { useWizardContinue } from "@/hooks/useWizardContinue";
import { TOTAL_STEPS, firstStepPath, stepNumber } from "@/constants/wizard";
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
 *
 * Booking rules (shortest and longest stay, how far ahead) are optional and
 * folded under the hours. New hours never cancel a booking already paid for;
 * when some fall outside them the screen says how many before moving on.
 */

/** Rule choices in minutes (stays) or days (advance); null = no rule of the host's own. */
const MIN_CHOICES = [null, 60, 120, 240];
const MAX_CHOICES = [null, 240, 480, 720, 1440];
const ADVANCE_CHOICES = [null, 7, 14, 30, 60];

type RuleChoice = number | null | "custom";

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
  const proceed = useWizardContinue("availability");

  const [preset, setPreset] = useState<Preset>("always");
  const [days, setDays] = useState<number[]>(ALL_DAYS);
  const [shared, setShared] = useState<Hours>(ALL_DAY);
  const [perDay, setPerDay] = useState(false);
  const [dayHours, setDayHours] = useState<Record<number, Hours>>({});
  const [minStay, setMinStay] = useState<RuleChoice>(null);
  const [minCustom, setMinCustom] = useState("");
  const [maxStay, setMaxStay] = useState<RuleChoice>(null);
  const [maxCustom, setMaxCustom] = useState("");
  const [advance, setAdvance] = useState<number | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [outside, setOutside] = useState<OutsideHours | null>(null);

  /**
   * Rebuilds the controls from what the server holds.
   *
   * One window per day is what this screen can express, so a spot whose
   * windows were set elsewhere (two on one day, say) reads back as its first
   * window for that day. Saving then replaces the lot -- which is what the
   * PUT does anyway, and why the screen has to show the truth it is about to
   * overwrite rather than a blank default.
   */
  // The rules, read back as a preset or a custom number of hours.
  useEffect(() => {
    if (!spot) return;
    const choice = (minutes: number | null, presets: (number | null)[], setCustom: (v: string) => void): RuleChoice => {
      if (presets.includes(minutes)) return minutes;
      setCustom(String((minutes ?? 0) / 60));
      return "custom";
    };
    setMinStay(choice(spot.minStayMinutes, MIN_CHOICES, setMinCustom));
    setMaxStay(choice(spot.maxStayMinutes, MAX_CHOICES, setMaxCustom));
    setAdvance(spot.advanceDays);
    setRulesOpen(Boolean(spot.minStayMinutes || spot.maxStayMinutes || spot.advanceDays));
  }, [spot]);

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

  // Any change after the notice means Continue has to save again.
  useEffect(() => {
    setOutside(null);
  }, [days, shared, perDay, dayHours, minStay, minCustom, maxStay, maxCustom, advance]);

  const minutesOf = (choice: RuleChoice, custom: string) =>
    choice === "custom" ? (custom.trim() ? Math.round(Number(custom) * 60) : NaN) : choice;
  const minMinutes = minutesOf(minStay, minCustom);
  const maxMinutes = minutesOf(maxStay, maxCustom);
  const customBad = (v: number | null) => v !== null && (!Number.isFinite(v) || v < 60 || v > 720 * 60);
  const rulesProblem = customBad(minMinutes) || customBad(maxMinutes)
    ? "A custom duration is between 1 and 720 hours."
    : minMinutes !== null && maxMinutes !== null && minMinutes > maxMinutes
      ? "The longest stay can't be shorter than the shortest."
      : null;
  const badHours = (perDay ? days.map(hoursFor) : [shared]).some((h) => h.startMinute >= h.endMinute);

  const { run: save, busy, error } = useAsyncAction(async () => {
    if (!token || !spot) return;

    // Saved already, and the host has read which bookings fall outside.
    if (outside) {
      proceed(spot);
      return;
    }

    const saved = await spotListingApi.saveAvailability(
      token,
      spot.id,
      days.map((dayOfWeek) => ({
        dayOfWeek,
        ...(perDay ? hoursFor(dayOfWeek) : shared),
      }))
    );
    await spotListingApi.saveBookingRules(token, spot.id, {
      minStayMinutes: minMinutes,
      maxStayMinutes: maxMinutes,
      advanceDays: advance,
    });

    // Never silent: paid bookings the new hours leave out still go ahead,
    // and the host is told so before moving on.
    if (saved.outsideHours.bookings > 0 || saved.outsideHours.monthlyDays > 0) {
      setOutside(saved.outsideHours);
      return;
    }

    proceed(spot);
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
      canContinue={days.length > 0 && !rulesProblem && !badHours}
      busy={busy}
      error={error}
      footerNote={
        days.length === 0
          ? "Pick at least one day."
          : badHours
            ? "Closing time has to be after opening time."
            : rulesProblem ?? undefined
      }
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
                    aria-checked={on}
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

      <View style={s.rules}>
        <Pressable
          onPress={() => setRulesOpen(!rulesOpen)}
          accessibilityRole="button"
          accessibilityState={{ expanded: rulesOpen }}
        aria-expanded={rulesOpen}
          style={s.rulesHead}
        >
          <Text style={s.rulesTitle}>
            Booking rules <Text style={s.optional}>optional</Text>
          </Text>
          <View style={rulesOpen ? s.flip : undefined}>
            <ChevronDownIcon size={18} color={colors.ink} />
          </View>
        </Pressable>

        {rulesOpen ? (
          <View style={s.rulesBody}>
            <RuleRow
              label="Minimum booking duration"
              choices={MIN_CHOICES}
              value={minStay}
              onChange={setMinStay}
              none="No minimum"
              unit={(m) => durationText(m)}
            />
            {minStay === "custom" ? (
              <Field
                label="Minimum (hours)"
                value={minCustom}
                onChangeText={(t) => setMinCustom(t.replace(/[^0-9.]/g, "").slice(0, 5))}
                keyboardType="decimal-pad"
                placeholder="3"
              />
            ) : null}
            <RuleRow
              label="Maximum booking duration"
              choices={MAX_CHOICES}
              value={maxStay}
              onChange={setMaxStay}
              none="No maximum"
              unit={(m) => (m === 1440 ? "24 hours" : durationText(m))}
            />
            {maxStay === "custom" ? (
              <Field
                label="Maximum (hours)"
                value={maxCustom}
                onChangeText={(t) => setMaxCustom(t.replace(/[^0-9.]/g, "").slice(0, 5))}
                keyboardType="decimal-pad"
                placeholder="48"
              />
            ) : null}
            <RuleRow
              label="How far ahead can drivers book?"
              choices={ADVANCE_CHOICES}
              value={advance}
              onChange={(v) => setAdvance(v === "custom" ? null : v)}
              none="Any time"
              unit={(d) => `${d} days`}
              noCustom
            />
          </View>
        ) : null}
      </View>

      {outside ? (
        <View style={s.outside} accessibilityLiveRegion="polite">
          <Text style={s.outsideTitle}>Saved. Some bookings fall outside these hours</Text>
          <Text style={s.outsideBody}>
            {[
              outside.bookings ? `${outside.bookings} upcoming paid ${outside.bookings === 1 ? "booking" : "bookings"}` : null,
              outside.monthlyDays ? `${outside.monthlyDays} monthly ${outside.monthlyDays === 1 ? "day" : "days"}` : null,
            ]
              .filter(Boolean)
              .join(" and ")}{" "}
            still go ahead as booked — changing hours never cancels a driver. If you can't honour them, cancel them from
            your bookings.
          </Text>
        </View>
      ) : null}

      <Text style={s.note}>
        You can switch any day off later without taking the listing down — this
        is the schedule, not a commitment.
      </Text>
    </WizardShell>
  );
}

function RuleRow({
  label,
  choices,
  value,
  onChange,
  none,
  unit,
  noCustom,
}: {
  label: string;
  choices: (number | null)[];
  value: RuleChoice;
  onChange: (value: RuleChoice) => void;
  none: string;
  unit: (value: number) => string;
  noCustom?: boolean;
}) {
  const options: { key: string; value: RuleChoice; text: string }[] = [
    ...choices.map((c) => ({ key: String(c), value: c, text: c === null ? none : unit(c) })),
    ...(noCustom ? [] : [{ key: "custom", value: "custom" as const, text: "Custom" }]),
  ];
  return (
    <View style={s.ruleRow}>
      <Text style={s.ruleLabel}>{label}</Text>
      <View style={s.ruleChips} accessibilityRole="radiogroup">
        {options.map((option) => {
          const on = option.value === value;
          return (
            <Pressable
              key={option.key}
              onPress={() => onChange(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
                    aria-checked={on}
              style={[s.ruleChip, on && s.ruleChipOn]}
            >
              <Text style={[s.ruleChipText, on && s.ruleChipTextOn]}>{option.text}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  rules: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  rulesHead: {
    minHeight: 52,
    paddingHorizontal: space.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rulesTitle: { fontSize: 15, fontWeight: "600", color: colors.ink },
  optional: { fontSize: 11, fontWeight: "400", color: colors.inkFaint },
  flip: { transform: [{ rotate: "180deg" }] },
  rulesBody: { gap: space.lg, paddingHorizontal: space.lg, paddingBottom: space.lg },
  ruleRow: { gap: space.sm },
  ruleLabel: { ...type.label, color: colors.ink },
  ruleChips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  ruleChip: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  ruleChipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  ruleChipText: { fontSize: 13, fontWeight: "600", color: colors.ink },
  ruleChipTextOn: { color: colors.onInk },
  outside: { backgroundColor: colors.accentSurface, borderRadius: radius.md, padding: space.lg, gap: 4 },
  outsideTitle: { fontSize: 14, fontWeight: "700", color: colors.accentInk },
  outsideBody: { fontSize: 13, lineHeight: 19, color: colors.accentInk },
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
