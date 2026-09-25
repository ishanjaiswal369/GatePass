import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, bookingsApi } from "@/api";
import {
  Button,
  CalendarIcon,
  CarIcon,
  ChevronRightIcon,
  DataRow,
  ErrorNotice,
  PhoneFrame,
  RestoringScreen,
  ScreenHeader,
} from "@/components/ui";
import { AccessCard } from "@/features/bookings/AccessCard";
import { ParkedCard } from "@/features/bookings/ParkedCard";
import { ParkingActions } from "@/features/bookings/ParkingActions";
import { useNow } from "@/features/bookings/useNow";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useDriverLocation } from "@/hooks/useDriverLocation";
import { bookingListing, bookingRef, bookingWhen, isSpotBooking } from "@/lib/booking";
import { formatRupees } from "@/lib/money";
import { toParams } from "@/lib/searchCriteria";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space } from "@/theme";
import type { BookingDetail, BookingRow } from "@/types/api.types";

type Choice = "have" | "without" | null;

/** A stay booked from now: the next quarter hour, for two hours. */
function stayFromNow(): { from: string; to: string } {
  const start = new Date();
  start.setSeconds(0, 0);
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15);
  return { from: start.toISOString(), to: new Date(start.getTime() + 2 * 3_600_000).toISOString() };
}

/**
 * Home's "Already parked".
 *
 * A driver who taps it wants one of two things, and this screen works out
 * which: if a stay is running, it opens straight onto it -- time left, how to
 * get in -- with nothing to choose. Otherwise it asks, because "already
 * parked" then means either a booking that hasn't started yet or a car left
 * somewhere without one.
 */
export default function ParkingScreen() {
  const { token, isRestoring } = useSession();
  const now = useNow();
  const { requestLocation } = useDriverLocation();

  const [active, setActive] = useState<BookingDetail | null>(null);
  const [today, setToday] = useState<BookingRow[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const { booking } = await bookingsApi.active(token);
      // The detail carries the access instructions, which a list row never does.
      setActive(booking ? await bookingsApi.get(token, booking.id) : null);

      if (!booking) {
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);
        const { items } = await bookingsApi.list(token, "upcoming");
        setToday(items.filter((row) => row.startsAt && Date.parse(row.startsAt) <= endOfDay.getTime()));
      }
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not check your parking.");
    } finally {
      setLoaded(true);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const { run: findHere, busy: locating, error: locationError } = useAsyncAction(async () => {
    const at = await requestLocation();
    if (!at) {
      throw new Error("We couldn't access your location. Search for the area instead.");
    }
    router.push({
      pathname: "/spots/results",
      params: toParams({
        mode: "hourly",
        place: { latitude: at.latitude, longitude: at.longitude, label: "Where you are" },
        ...stayFromNow(),
      }),
    });
  });

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader title={active ? "You're parked" : "Already parked"} onBack={back} />

        <ScrollView contentContainerStyle={s.body}>
          {error ? <ErrorNotice message={error} /> : null}

          {!loaded ? (
            <ActivityIndicator color={colors.ink} style={s.loading} />
          ) : active ? (
            <>
              <ParkedCard row={active} now={now} compact />
              <ParkingActions row={active} />
              {isSpotBooking(active) ? (
                <AccessCard instructions={active.access?.accessInstructions ?? null} released={active.access !== null} />
              ) : null}
              <View style={s.card}>
                <DataRow label="Location" value={bookingListing(active)?.addressLine ?? bookingListing(active)?.venueName} />
                <DataRow label="Vehicle" value={active.vehicleNumber} />
                <DataRow label="Booking ID" value={bookingRef(active.id)} />
                <DataRow
                  label="Paid"
                  value={active.payment?.status === "CAPTURED" ? formatRupees(active.payment.amount) : "—"}
                />
              </View>
              <Button
                label="Open booking"
                variant="ghost"
                onPress={() => router.push({ pathname: "/booking/[id]", params: { id: active.id } })}
              />
            </>
          ) : (
            <>
              <View style={s.gap6}>
                <Text style={s.title}>Are you already parked?</Text>
                <Text style={s.muted}>You don't have a parking session running right now.</Text>
              </View>

              <Option
                icon={<CalendarIcon size={21} color={colors.ink} />}
                title="I have a booking"
                sub="Show my bookings for today"
                on={choice === "have"}
                onPress={() => setChoice("have")}
              />
              <Option
                icon={<CarIcon size={21} />}
                title="I parked without booking"
                sub="Find this space and book it from now"
                on={choice === "without"}
                onPress={() => setChoice("without")}
              />

              {choice === "have" ? (
                <View style={s.gap}>
                  <Text style={s.label}>YOUR BOOKINGS FOR TODAY</Text>
                  {today && today.length > 0 ? (
                    today.map((row) => (
                      <Pressable
                        key={row.id}
                        onPress={() => router.push({ pathname: "/booking/[id]", params: { id: row.id } })}
                        accessibilityRole="button"
                        style={({ pressed }) => [s.todayRow, pressed && s.pressed]}
                      >
                        <View style={s.flex}>
                          <Text style={s.rowTitle}>{bookingListing(row)?.name ?? "Parking"}</Text>
                          <Text style={s.muted}>{bookingWhen(row)}</Text>
                        </View>
                        <ChevronRightIcon color={colors.inkMuted} size={18} />
                      </Pressable>
                    ))
                  ) : (
                    <Text style={s.muted}>
                      Nothing booked for today. A booking you made for later shows under Bookings → Upcoming.
                    </Text>
                  )}
                  <Text style={s.fine}>
                    A booking becomes active on its own at its start time; you don't need to check in.
                  </Text>
                </View>
              ) : null}

              {choice === "without" ? (
                <View style={s.gap}>
                  <Text style={s.muted}>
                    We'll use your location to show GatePass spaces around you that are free from now. Only
                    spaces listed on GatePass can be booked this way.
                  </Text>
                  {locationError ? <ErrorNotice message={locationError} /> : null}
                  <Button label="Find spaces around me" onPress={findHere} busy={locating} />
                  <Button label="Search an area instead" variant="ghost" onPress={() => router.push("/home")} />
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      </View>
    </PhoneFrame>
  );
}

function Option({
  icon,
  title,
  sub,
  on,
  onPress,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      style={({ pressed }) => [s.option, on && s.optionOn, pressed && s.pressed]}
    >
      <View style={s.optionBadge}>{icon}</View>
      <View style={s.flex}>
        <Text style={s.rowTitle}>{title}</Text>
        <Text style={s.muted}>{sub}</Text>
      </View>
      <ChevronRightIcon color={colors.inkMuted} size={18} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  body: { padding: 20, gap: space.lg, paddingBottom: 32 },
  loading: { paddingVertical: space.xxl },
  gap: { gap: space.md },
  gap6: { gap: 6 },
  flex: { flex: 1, gap: 2 },
  title: { fontSize: 22, fontWeight: "700", color: colors.ink },
  muted: { fontSize: 14, lineHeight: 20, color: colors.inkMuted },
  fine: { fontSize: 12, lineHeight: 18, color: colors.inkMuted },
  label: { fontSize: 12, fontWeight: "700", letterSpacing: 1.2, color: colors.inkMuted },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  option: {
    minHeight: 76,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  optionOn: { borderWidth: 2, borderColor: colors.ink },
  optionBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.canvas,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: { fontSize: 16, fontWeight: "700", color: colors.ink },
  todayRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
  },
  pressed: { backgroundColor: colors.canvas },
});
