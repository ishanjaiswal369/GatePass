import { Redirect, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { ApiError, hostApi } from "@/api";
import {
  CalendarIcon,
  CameraIcon,
  ChevronRightIcon,
  ErrorNotice,
  KeyIcon,
  PhoneFrame,
  RestoringScreen,
  ScreenHeader,
  StatusChip,
  WalletIcon,
} from "@/components/ui";
import { HostBookingCard } from "@/features/host/HostBookingCard";
import { listingStatus } from "@/lib/listingRules";
import { clockTime } from "@/lib/booking";
import { formatRupees } from "@/lib/money";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space } from "@/theme";
import type { HostOverview } from "@/types/api.types";

/** "today, 3:00 PM" / "Fri, 3:00 PM". */
function whenShort(iso: string): string {
  const at = new Date(iso);
  const today = new Date().toDateString() === at.toDateString();
  return `${today ? "today" : at.toLocaleDateString("en-IN", { weekday: "short" })}, ${clockTime(iso)}`;
}

/**
 * One space, run day to day: the prototype's Listing dashboard.
 *
 * Numbers first (today, upcoming, this month, rating), then today's list,
 * then the handful of things a host actually does: pause new bookings, change
 * prices, block dates, fix the access instructions. Each of those opens the
 * screen that already does it -- the wizard step or the calendar -- rather
 * than a second copy of it.
 */
export default function ListingDashboardScreen() {
  const { token, isRestoring } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<HostOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pausing, setPausing] = useState(false);

  const load = useCallback(async () => {
    if (!token || !id) return;
    try {
      setData(await hostApi.overview(token, id));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? "This space isn't yours, or no longer exists." : "Could not load this space.");
    }
  }, [token, id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  const back = () => (router.canGoBack() ? router.back() : router.replace("/host"));

  const togglePause = async (paused: boolean) => {
    if (!data || !id) return;
    setPausing(true);
    setData({ ...data, listing: { ...data.listing, paused } });
    try {
      await hostApi.setPaused(token, id, paused);
    } catch {
      setData({ ...data, listing: { ...data.listing, paused: !paused } });
      setError("Couldn't change that. Try again.");
    } finally {
      setPausing(false);
    }
  };

  const go = (pathname: string, params: Record<string, string> = {}) =>
    router.push({ pathname: pathname as never, params: { id: id!, ...params } });

  const live = data ? !data.listing.paused && (data.listing.status === "PUBLISHED" || data.listing.status === "ONGOING") : false;

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader
          title={data?.listing.name ?? "Your space"}
          sub={data ? `${data.listing.address}${data.listing.address ? " · " : ""}${live ? "Active · taking bookings" : data.listing.paused ? "Paused · not taking new bookings" : "Not live"}` : null}
          onBack={back}
        />

        <ScrollView contentContainerStyle={s.body}>
          {error ? <ErrorNotice message={error} /> : null}

          {!data ? (
            error ? null : <ActivityIndicator color={colors.ink} style={s.loading} />
          ) : (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.nav}>
                <NavChip label="Overview" on />
                <NavChip label="Bookings" onPress={() => router.push({ pathname: "/host/bookings", params: { listingId: id! } })} />
                <NavChip label="Calendar" onPress={() => go("/host/listing/[id]/calendar")} />
                <NavChip label="Earnings" onPress={() => router.push("/host/earnings")} />
                {data.rating.count > 0 ? <NavChip label="Reviews" onPress={() => router.push({ pathname: "/spots/reviews", params: { id: id! } })} /> : null}
                <NavChip label="Parking details" onPress={() => router.push({ pathname: "/host/spot", params: { id: id! } })} />
                <NavChip label="Availability" onPress={() => router.push({ pathname: "/host/spot/availability", params: { id: id! } })} />
              </ScrollView>

              <View style={s.tiles}>
                <Tile title="Today's bookings" value={String(data.today.count)} sub={`${data.today.parkedNow} parked now`} />
                <Tile
                  title="Upcoming"
                  value={String(data.upcoming.count)}
                  sub={data.upcoming.nextStartsAt ? `Next: ${whenShort(data.upcoming.nextStartsAt)}` : "None booked yet"}
                />
                <Tile
                  title="This month"
                  value={formatRupees(data.month.net)}
                  sub={`after ${Math.round(data.month.commissionRate * 100)}% fee`}
                />
                <Tile
                  title="Rating"
                  value={data.rating.average !== null ? data.rating.average.toFixed(1) : "New"}
                  sub={data.rating.count > 0 ? `${data.rating.count} ${data.rating.count === 1 ? "review" : "reviews"}` : "No reviews yet"}
                />
              </View>

              <View style={s.sectionHead}>
                <Text style={s.label}>TODAY</Text>
                <Pressable onPress={() => go("/host/listing/[id]/calendar")} accessibilityRole="link" hitSlop={10}>
                  <Text style={s.link}>Calendar</Text>
                </Pressable>
              </View>
              {data.today.bookings.length === 0 ? (
                <Text style={s.muted}>No bookings today.</Text>
              ) : (
                data.today.bookings.map((b) => <HostBookingCard key={b.id} booking={b} />)
              )}

              {data.listing.photoCount < 2 ? (
                <Pressable onPress={() => router.push({ pathname: "/host/spot/photos", params: { id: id! } })} style={s.tip} accessibilityRole="button">
                  <CameraIcon size={20} />
                  <View style={s.flex}>
                    <Text style={s.tipTitle}>Add an entrance photo</Text>
                    <Text style={s.muted}>Drivers find the gate faster when one photo shows the entrance from the street.</Text>
                  </View>
                  <ChevronRightIcon />
                </Pressable>
              ) : null}

              <Text style={s.label}>QUICK ACTIONS</Text>
              <View style={s.card}>
                <View style={s.row}>
                  <View style={s.flex}>
                    <Text style={s.rowTitle}>Pause new bookings</Text>
                    <Text style={s.muted}>Bookings already made stay confirmed</Text>
                  </View>
                  <Switch
                    value={data.listing.paused}
                    onValueChange={(v) => void togglePause(v)}
                    disabled={pausing}
                    accessibilityLabel="Pause new bookings"
                    trackColor={{ true: colors.ink, false: "#d1d5db" }}
                    thumbColor={colors.surface}
                    {...({ activeThumbColor: colors.surface } as object)}
                  />
                </View>
                <Action icon={<WalletIcon size={18} />} label="Edit prices" onPress={() => router.push({ pathname: "/host/spot/pricing", params: { id: id! } })} />
                <Action icon={<CalendarIcon size={18} color={colors.ink} />} label="Block dates" onPress={() => go("/host/listing/[id]/calendar")} />
                <Action icon={<KeyIcon size={18} color={colors.ink} />} label="Access instructions" onPress={() => router.push({ pathname: "/host/spot/access", params: { id: id! } })} />
                <Action label="Parking details" onPress={() => router.push({ pathname: "/host/spot/details", params: { id: id! } })} />
                <Action label="Availability and booking rules" onPress={() => router.push({ pathname: "/host/spot/availability", params: { id: id! } })} last />
              </View>
              {data.listing.status !== "PUBLISHED" && data.listing.status !== "ONGOING" ? (
                <StatusChip label={listingStatus({ ...data.listing, docApprovedAt: null, bookingsPausedAt: null }).label} tone="warning" />
              ) : null}
            </>
          )}
        </ScrollView>
      </View>
    </PhoneFrame>
  );
}

function NavChip({ label, on, onPress }: { label: string; on?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={on}
      accessibilityRole="tab"
      accessibilityState={{ selected: !!on }}
      style={[s.navChip, on && s.navChipOn]}
    >
      <Text style={[s.navText, on && s.navTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Tile({ title, value, sub }: { title: string; value: string; sub: string }) {
  return (
    <View style={s.tile}>
      <Text style={s.muted}>{title}</Text>
      <Text style={s.tileValue}>{value}</Text>
      <Text style={s.small}>{sub}</Text>
    </View>
  );
}

function Action({ icon, label, onPress, last }: { icon?: React.ReactNode; label: string; onPress: () => void; last?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [s.row, last && s.last, pressed && s.pressed]}>
      {icon ? <View style={s.icon}>{icon}</View> : null}
      <Text style={[s.rowTitle, s.flex]}>{label}</Text>
      <ChevronRightIcon />
    </Pressable>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  body: { padding: 20, gap: space.lg, paddingBottom: 32 },
  loading: { paddingVertical: space.xxl },
  nav: { gap: space.sm, paddingRight: 20 },
  navChip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: "center", backgroundColor: colors.canvas },
  navChipOn: { backgroundColor: colors.ink },
  navText: { fontSize: 13, fontWeight: "600", color: "#374151" },
  navTextOn: { color: colors.onInk },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { flexBasis: "47%", flexGrow: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 14, gap: 2 },
  tileValue: { fontSize: 22, fontWeight: "700", color: colors.ink },
  small: { fontSize: 12, color: colors.inkMuted },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { fontSize: 12, fontWeight: "700", letterSpacing: 1.2, color: colors.inkMuted },
  link: { fontSize: 13, fontWeight: "600", color: colors.ink, textDecorationLine: "underline" },
  muted: { fontSize: 13, color: colors.inkMuted },
  tip: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.accentSurface, borderRadius: radius.md, padding: space.lg },
  tipTitle: { fontSize: 14, fontWeight: "700", color: colors.ink },
  flex: { flex: 1, gap: 2 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.lg },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 56, borderBottomWidth: 1, borderBottomColor: colors.border },
  last: { borderBottomWidth: 0 },
  pressed: { backgroundColor: colors.canvas },
  icon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.canvas, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 15, fontWeight: "600", color: colors.ink },
});
