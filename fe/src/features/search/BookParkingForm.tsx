import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button, PickerField, type SheetOption, minuteOptions } from "@/components/ui";
import {
  MAX_DAYS_AHEAD,
  MAX_STAY_DAYS,
  MIN_STAY_MINUTES,
  addDays,
  atMinute,
  dayLabel,
  fromDateKey,
  nextStepMinute,
  toDateKey,
  type SearchCriteria,
  type SearchPlace,
} from "@/lib/searchCriteria";
import { colors, radius, space, type } from "@/theme";
import { LocationField } from "./LocationField";
import {
  freshen,
  loadDraft,
  peekDraft,
  saveDraft,
  type SearchDraft,
} from "./searchDraft";

/**
 * What the driver is looking for: where, and from when until when. A stay
 * can run from fifteen minutes to several days; it is priced by the hour or
 * the day, whichever is cheaper.
 */

/** A driver books to the quarter hour; a host sets opening hours by the half. */
const DRIVER_STEP_MINUTES = 15;

function dayOptions(count: number): SheetOption<string>[] {
  const today = new Date();

  return Array.from({ length: count }, (_, index) => {
    const date = addDays(today, index);
    return { value: toDateKey(date), label: dayLabel(date) };
  });
}

export function BookParkingForm({
  token,
  onSearch,
}: {
  token: string | null;
  onSearch: (criteria: SearchCriteria) => void;
}) {
  const now = useMemo(() => new Date(), []);
  const days = useMemo(() => dayOptions(MAX_DAYS_AHEAD), []);

  // The next quarter hour, for two hours -- the shape of
  // almost every hourly booking, so most drivers change nothing here.
  //
  // The end is derived as an instant and read back, rather than clamped to
  // the end of the day: at 23:45 clamping produced a fifteen-minute stay,
  // which is a valid booking and not remotely what was meant.
  const defaults = useMemo((): SearchDraft => {
    const start = atMinute(toDateKey(now), nextStepMinute(now, DRIVER_STEP_MINUTES));
    const end = new Date(start.getTime() + 2 * 60 * 60_000);

    return {
      place: null,
      fromDate: toDateKey(start),
      fromMinute: start.getHours() * 60 + start.getMinutes(),
      toDate: toDateKey(end),
      toMinute: end.getHours() * 60 + end.getMinutes(),
    };
  }, [now]);

  // Whatever the driver last had here, if this launch has seen it. Read
  // synchronously so a remount -- a tab switch, a trip to Bookings and back --
  // opens on their draft rather than flashing the defaults first.
  const [initial] = useState(() => {
    const held = peekDraft();
    return held ? freshen(held, defaults, now) : defaults;
  });

  const [place, setPlace] = useState<SearchPlace | null>(initial.place);

  const [fromDate, setFromDate] = useState(initial.fromDate);
  const [fromMinute, setFromMinute] = useState(initial.fromMinute);
  const [toDate, setToDate] = useState(initial.toDate);
  const [toMinute, setToMinute] = useState(initial.toMinute);

  /**
   * Whether the stored draft has been taken into account. Until it has,
   * nothing is saved: writing this screen's defaults first would overwrite
   * the very draft a reload is supposed to bring back.
   */
  const [ready, setReady] = useState(() => peekDraft() !== null);

  useEffect(() => {
    if (ready) return;

    let cancelled = false;

    void loadDraft().then((stored) => {
      if (cancelled) return;

      if (stored) {
        const d = freshen(stored, defaults, now);
        setPlace(d.place);
        setFromDate(d.fromDate);
        setFromMinute(d.fromMinute);
        setToDate(d.toDate);
        setToMinute(d.toMinute);
      }

      setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [ready, defaults, now]);

  useEffect(() => {
    if (!ready) return;

    saveDraft({ place, fromDate, fromMinute, toDate, toMinute });
  }, [ready, place, fromDate, fromMinute, toDate, toMinute]);

  const from = atMinute(fromDate, fromMinute);
  const to = atMinute(toDate, toMinute);
  const stayMinutes = (to.getTime() - from.getTime()) / 60_000;

  // Leaving on a later day is a choice the driver makes, not a guess.
  const multiDay = toDate !== fromDate;

  const problem =
    stayMinutes <= 0
      ? multiDay
        ? "You're leaving before you arrive."
        : 'The end time has to be after the start. Leaving the next day? Choose "Leaving on a later day".'
      : stayMinutes < MIN_STAY_MINUTES
      ? `Minimum stay is ${MIN_STAY_MINUTES} minutes.`
      : stayMinutes > MAX_STAY_DAYS * 24 * 60
        ? `A stay can be up to ${MAX_STAY_DAYS} days.`
        : null;

  const canSearch = place !== null && problem === null;

  const search = () => {
    if (!place) return;

    onSearch({ place, from: from.toISOString(), to: to.toISOString() });
  };

  return (
    <View style={s.wrap}>
      <View style={s.card}>
        <Text style={s.cardHeading}>Where</Text>
        <LocationField token={token} place={place} onChange={setPlace} />
      </View>

      <View style={s.card}>
        <Text style={s.cardHeading}>When</Text>

        <PickerField
          label="Date"
          title="Parking on"
          value={fromDate}
          options={days}
          onChange={(next) => {
            setFromDate(next);
            // A same-day stay follows the date; a later-day stay keeps its
            // end date unless the start overtakes it.
            if (!multiDay) setToDate(next);
            else if (next >= toDate) setToDate(toDateKey(addDays(fromDateKey(next), 1)));
          }}
        />

        <View style={s.row}>
          <PickerField
            label="Start"
            title="Arriving at"
            value={fromMinute}
            options={minuteOptions(0, 24 * 60 - DRIVER_STEP_MINUTES, DRIVER_STEP_MINUTES)}
            onChange={setFromMinute}
          />
          <PickerField
            label="End"
            title="Leaving at"
            value={toMinute}
            options={minuteOptions(DRIVER_STEP_MINUTES, 24 * 60, DRIVER_STEP_MINUTES)}
            onChange={setToMinute}
          />
        </View>

        {multiDay ? (
          <PickerField
            label="Leaving on"
            value={toDate}
            options={days.filter((day) => day.value > fromDate)}
            onChange={setToDate}
          />
        ) : null}

        <Pressable
          onPress={() => setToDate(multiDay ? fromDate : toDateKey(addDays(fromDateKey(fromDate), 1)))}
          accessibilityRole="switch"
          accessibilityState={{ checked: multiDay }}
          style={s.laterDay}
        >
          <Text style={s.laterDayText}>{multiDay ? "Leaving the same day" : "Leaving on a later day?"}</Text>
        </Pressable>

        {problem ? null : <Text style={s.summary}>{describeStay(stayMinutes)}</Text>}
      </View>

      <Button
        label="Find Parking"
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
  laterDay: { minHeight: 40, justifyContent: "center", alignSelf: "flex-start" },
  laterDayText: { fontSize: 14, fontWeight: "600", color: colors.ink, textDecorationLine: "underline" },
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
  summary: { fontSize: 13, fontWeight: "600", color: colors.accent },
  note: { ...type.caption, color: colors.inkFaint, textAlign: "center" },
});
