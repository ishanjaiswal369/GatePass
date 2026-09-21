import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { spotListingApi } from "@/api";
import {
  Checkbox,
  OptionCard,
  RestoringScreen,
  WizardShell,
} from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { TOTAL_STEPS, nextStepPath, stepNumber } from "@/constants/wizard";
import { colors, radius, space, type } from "@/theme";

/**
 * Step 4. When the space is free.
 *
 * Three presets because almost every host is one of them, and the custom case
 * is the same data with the days picked by hand. Windows are whole days here:
 * part-day windows are what the existing availability screen already edits,
 * and asking for start and end times in the middle of onboarding is where
 * hosts drop out.
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

const FULL_DAY = { startMinute: 0, endMinute: 1440 };

type Preset = "always" | "working" | "custom";

export default function AvailabilityScreen() {
  const { spot, loading, isRestoring, token } = useSpotDraft();

  const [preset, setPreset] = useState<Preset>("always");
  const [days, setDays] = useState<number[]>(ALL_DAYS);

  useEffect(() => {
    if (!spot?.availability?.length) return;

    const active = spot.availability
      .filter((window) => window.isActive)
      .map((window) => window.dayOfWeek);
    const unique = [...new Set(active)].sort();

    setDays(unique);
    setPreset(
      unique.length === 7
        ? "always"
        : unique.join() === WORKING_WEEK.join()
          ? "working"
          : "custom"
    );
  }, [spot]);

  const choose = (next: Preset) => {
    setPreset(next);
    if (next === "always") setDays(ALL_DAYS);
    if (next === "working") setDays(WORKING_WEEK);
  };

  const toggleDay = (day: number) => {
    setPreset("custom");
    setDays((current) =>
      current.includes(day)
        ? current.filter((value) => value !== day)
        : [...current, day].sort()
    );
  };

  const { run: save, busy, error } = useAsyncAction(async () => {
    if (!token || !spot) return;

    await spotListingApi.saveAvailability(
      token,
      spot.id,
      days.map((dayOfWeek) => ({ dayOfWeek, ...FULL_DAY }))
    );

    router.push(nextStepPath("availability", spot.id));
  });

  if (isRestoring || loading) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;
  if (!spot) return <Redirect href="/host/spot" />;

  return (
    <WizardShell
      title="Availability"
      sub="When can drivers book it?"
      step={stepNumber("availability")}
      totalSteps={TOTAL_STEPS}
      onBack={() => router.back()}
      onContinue={save}
      canContinue={days.length > 0}
      busy={busy}
      error={error}
      footerNote={days.length === 0 ? "Pick at least one day." : undefined}
    >
      <OptionCard
        label="Always"
        description="Every day of the week."
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
  note: { ...type.caption, color: colors.inkFaint, lineHeight: 18 },
});
