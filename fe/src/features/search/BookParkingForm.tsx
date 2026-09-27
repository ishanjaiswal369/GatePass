import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { profileApi } from "@/api";
import { Button, PickerField, PlusIcon, type SheetOption, minuteOptions } from "@/components/ui";
import { useNow } from "@/features/bookings/useNow";
import { ANY_VEHICLE, searchVehicle, vehicleLine } from "@/lib/searchVehicle";
import type { Vehicle } from "@/types/api.types";
import {
  MAX_DAYS_AHEAD,
  MAX_STAY_DAYS,
  MIN_STAY_MINUTES,
  addDays,
  atMinute,
  dayLabel,
  fromDateKey,
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
 * What the driver is looking for: where, from when until when, and in which
 * of their vehicles. A stay can run from fifteen minutes to several days; it
 * is priced by the hour or the day, whichever is cheaper. The vehicle decides
 * which spaces come back: a bike or scooter sees bike spaces, any car sees
 * every car space.
 */

/** A driver books to the quarter hour; a host sets opening hours by the half. */
const DRIVER_STEP_MINUTES = 15;

/**
 * The first start a driver can pick: the next quarter hour, as an instant --
 * so at 23:50 it is tomorrow's 00:00, not a clamped 23:45 that has passed.
 */
function soonestStart(now: number): Date {
  const step = DRIVER_STEP_MINUTES * 60_000;
  return new Date(Math.floor(now / step) * step + step);
}

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
  // The clock as it moves: a form left open past a start time must stop
  // offering it, and "Today" must move on at midnight.
  const clock = useNow(30_000);
  const today = toDateKey(new Date(clock));
  const days = useMemo(() => dayOptions(MAX_DAYS_AHEAD), [today]);

  // The next quarter hour, for two hours -- the shape of
  // almost every hourly booking, so most drivers change nothing here.
  //
  // The end is derived as an instant and read back, rather than clamped to
  // the end of the day: at 23:45 clamping produced a fifteen-minute stay,
  // which is a valid booking and not remotely what was meant.
  const defaults = useMemo((): SearchDraft => {
    const start = soonestStart(now.getTime());
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

  // The driver's vehicles, on every focus: "Add a vehicle" goes to another
  // screen and comes back without remounting this form. The choice starts on
  // the default and survives reloads while that vehicle still exists.
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [vehicle, setVehicle] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      let cancelled = false;
      profileApi
        .listVehicles(token)
        .then(({ vehicles: saved }) => {
          if (cancelled) return;
          setVehicles(saved);
          setVehicle((current) =>
            current === ANY_VEHICLE || saved.some((v) => v.id === current) ? current : searchVehicle(saved, null)?.id ?? null
          );
        })
        .catch(() => !cancelled && setVehicles([]));
      return () => {
        cancelled = true;
      };
    }, [token])
  );

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

  // On the soonest day, nothing before the next quarter hour; after it, any
  // time; before it (a form left open overnight), nothing.
  const soonest = soonestStart(clock);
  const soonestDate = toDateKey(soonest);
  const soonestMinute = soonest.getHours() * 60 + soonest.getMinutes();
  const earliestMinute = fromDate === soonestDate ? soonestMinute : fromDate < soonestDate ? Infinity : 0;
  // Left out rather than greyed: today's list then opens on times that can
  // be booked instead of a screenful of ones that can't.
  const startOptions = minuteOptions(0, 24 * 60 - DRIVER_STEP_MINUTES, DRIVER_STEP_MINUTES).filter(
    (option) => option.value >= earliestMinute
  );

  const problem =
    from.getTime() <= clock
      ? "That start time has already passed. Pick a later time."
      : stayMinutes <= 0
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

    onSearch({ place, from: from.toISOString(), to: to.toISOString(), vehicle: vehicle ?? ANY_VEHICLE });
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
            // Switching to today with a start that has already gone moves it
            // to the next quarter hour, keeping the length of the stay.
            if (next === soonestDate && fromMinute < soonestMinute) {
              const length = stayMinutes > 0 ? stayMinutes : 120;
              const end = new Date(soonest.getTime() + length * 60_000);
              setFromMinute(soonestMinute);
              setToMinute(end.getHours() * 60 + end.getMinutes());
              setToDate(toDateKey(end));
              return;
            }
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
            options={startOptions}
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

      <View style={s.card}>
        <Text style={s.cardHeading}>Vehicle</Text>
        {vehicles && vehicles.length > 0 ? (
          <PickerField
            label="Parking for"
            title="Which vehicle?"
            value={vehicle ?? ANY_VEHICLE}
            options={[
              ...vehicles.map((v) => ({ value: v.id, label: vehicleLine(v) + (v.isDefault ? " (default)" : "") })),
              { value: ANY_VEHICLE, label: "Any vehicle — show every space" },
            ]}
            onChange={setVehicle}
          />
        ) : vehicles ? (
          <Text style={s.vehicleNote}>No vehicle saved yet, so every space is shown. Add yours to see only the spaces it can use.</Text>
        ) : null}
        <Pressable onPress={() => router.push("/account/vehicles")} accessibilityRole="link" style={s.addVehicle}>
          <PlusIcon size={16} />
          <Text style={s.addVehicleText}>{vehicles && vehicles.length > 0 ? "Add another vehicle" : "Add a vehicle"}</Text>
        </Pressable>
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
  vehicleNote: { fontSize: 13, lineHeight: 19, color: colors.inkMuted },
  addVehicle: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 40, alignSelf: "flex-start" },
  addVehicleText: { fontSize: 14, fontWeight: "600", color: colors.ink },
});
