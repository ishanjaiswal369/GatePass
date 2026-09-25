import { Redirect, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, bookingsApi, monthlyApi } from "@/api";
import {
  BottomNav,
  Button,
  CalendarIcon,
  CarIcon,
  CheckIcon,
  EmptyState,
  ErrorNotice,
  PhoneFrame,
  RestoringScreen,
  type NavKey,
} from "@/components/ui";
import { BookingCard } from "@/features/bookings/BookingCard";
import { MonthlyCard } from "@/features/bookings/MonthlyCard";
import { ParkedCard } from "@/features/bookings/ParkedCard";
import { useNow } from "@/features/bookings/useNow";
import { useScreenInsets } from "@/hooks/useScreenInsets";
import { atMinute } from "@/lib/searchCriteria";
import { useSession } from "@/providers/SessionProvider";
import { colors, space } from "@/theme";
import type { BookingRow, MonthlyReservation } from "@/types/api.types";

type Scope = "upcoming" | "active" | "past";

const TABS: { key: Scope; label: string }[] = [
  { key: "upcoming", label: "Upcoming" },
  { key: "active", label: "Active" },
  { key: "past", label: "Past" },
];

function isScope(value: unknown): value is Scope {
  return value === "upcoming" || value === "active" || value === "past";
}

/**
 * Every booking, in three places by where it is in its life.
 *
 * Active is its own tab, not a badge on Upcoming: a driver standing at a gate
 * needs their running stay without reading past tomorrow's. The tab lives in
 * the URL so another screen can send a driver straight to it.
 */
export default function BookingsScreen() {
  const { token, isRestoring } = useSession();
  const insets = useScreenInsets();
  const params = useLocalSearchParams<{ tab?: string }>();
  const now = useNow();

  const [scope, setScope] = useState<Scope>(isScope(params.tab) ? params.tab : "upcoming");
  const [rows, setRows] = useState<BookingRow[] | null>(null);
  const [terms, setTerms] = useState<MonthlyReservation[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [parkedNow, setParkedNow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (which: Scope) => {
      if (!token) return;
      setRows(null);
      setError(null);

      try {
        // Monthly terms have no "parked now" moment, so they sit in Upcoming
        // while held or running and in Past once over, as the prototype has them.
        const [page, active, monthly] = await Promise.all([
          bookingsApi.list(token, which),
          bookingsApi.active(token),
          which === "active" ? Promise.resolve({ items: [] }) : monthlyApi.list(token, which === "past" ? "past" : "current"),
        ]);
        setTerms(monthly.items);
        setRows(page.items);
        setCursor(page.nextCursor);
        setParkedNow(active.booking !== null);
      } catch (err) {
        setRows([]);
        setTerms([]);
        setError(err instanceof ApiError ? err.message : "Could not load your bookings.");
      }
    },
    [token]
  );

  // On focus, not mount: a booking cancelled or extended on another screen
  // has to show here the moment the driver comes back.
  useFocusEffect(
    useCallback(() => {
      void load(scope);
    }, [load, scope])
  );

  const loadMore = async () => {
    if (!token || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await bookingsApi.list(token, scope, cursor);
      setRows((current) => [...(current ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load more bookings.");
    } finally {
      setLoadingMore(false);
    }
  };

  const choose = (next: Scope) => {
    if (next === scope) return;
    setScope(next);
    router.setParams({ tab: next });
  };

  const navigate = (key: NavKey) => {
    if (key === "home") router.push("/home");
    if (key === "host") router.push("/host");
    if (key === "profile") router.push("/account");
  };

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <View style={[s.head, { paddingTop: insets.top + 28 }]}>
          <Text style={s.title} accessibilityRole="header">
            Bookings
          </Text>
          <View style={s.tabs} accessibilityRole="tablist">
            {TABS.map((tab) => {
              const on = tab.key === scope;
              return (
                <Pressable
                  key={tab.key}
                  onPress={() => choose(tab.key)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  style={[s.tab, on && s.tabOn]}
                >
                  {tab.key === "active" && parkedNow ? <View style={s.liveDot} /> : null}
                  <Text style={[s.tabText, on && s.tabTextOn]}>{tab.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <ScrollView contentContainerStyle={s.body}>
          {error ? <ErrorNotice message={error} /> : null}

          {rows === null ? (
            <ActivityIndicator color={colors.ink} style={s.loading} />
          ) : rows.length === 0 && terms.length === 0 ? (
            <Empty scope={scope} failed={error !== null} onRetry={() => void load(scope)} />
          ) : (
            <>
              {mergeByDate(rows, terms, scope).map((item) =>
                item.kind === "monthly" ? (
                  <MonthlyCard key={item.row.id} row={item.row} now={now} />
                ) : item.row.phase === "ACTIVE" ? (
                  <ParkedCard key={item.row.id} row={item.row} now={now} />
                ) : (
                  <BookingCard key={item.row.id} row={item.row} now={now} />
                )
              )}

              {cursor ? (
                <Button
                  label={loadingMore ? "Loading…" : "Show more"}
                  variant="ghost"
                  busy={loadingMore}
                  onPress={() => void loadMore()}
                />
              ) : null}
            </>
          )}
        </ScrollView>

        <BottomNav active="bookings" onNavigate={navigate} />
      </View>
    </PhoneFrame>
  );
}

type Item = { kind: "booking"; row: BookingRow } | { kind: "monthly"; row: MonthlyReservation };

/**
 * Terms slotted into the bookings in the order the tab reads: Upcoming
 * soonest first, Past newest first. The bookings keep the server's order
 * (they are paged); each term goes before the first booking it sorts ahead of.
 */
function mergeByDate(rows: BookingRow[], terms: MonthlyReservation[], scope: Scope): Item[] {
  const upcoming = scope === "upcoming";
  const bookingKey = (row: BookingRow) =>
    upcoming ? Date.parse(row.startsAt ?? row.parkingCapacity?.listing.eventDate ?? "") : Date.parse(row.createdAt);
  const termKey = (term: MonthlyReservation) =>
    upcoming ? atMinute(term.startDate, term.startMinute).getTime() : Date.parse(term.createdAt);
  const before = (a: number, b: number) => (Number.isNaN(b) ? true : upcoming ? a < b : a > b);

  const pending = [...terms].sort((a, b) => (upcoming ? termKey(a) - termKey(b) : termKey(b) - termKey(a)));
  const items: Item[] = [];
  for (const row of rows) {
    while (pending.length > 0 && before(termKey(pending[0]), bookingKey(row))) {
      items.push({ kind: "monthly", row: pending.shift()! });
    }
    items.push({ kind: "booking", row });
  }
  return [...items, ...pending.map((row) => ({ kind: "monthly" as const, row }))];
}

function Empty({ scope, failed, onRetry }: { scope: Scope; failed: boolean; onRetry: () => void }) {
  if (failed) {
    return (
      <EmptyState icon={<CalendarIcon size={28} color={colors.ink} />} title="Something went wrong.">
        <Button label="Retry" onPress={onRetry} />
      </EmptyState>
    );
  }

  if (scope === "upcoming") {
    return (
      <EmptyState
        icon={<CalendarIcon size={28} color={colors.ink} />}
        title="No upcoming parking"
        body="Find a parking space near your destination."
      >
        <Button label="Find Parking" onPress={() => router.push("/home")} />
      </EmptyState>
    );
  }

  if (scope === "active") {
    return (
      <EmptyState
        icon={<CarIcon size={28} color={colors.ink} />}
        title="You're not currently parked."
        body="When a booking starts, it shows up here with directions and your access instructions."
      />
    );
  }

  return (
    <EmptyState
      icon={<CheckIcon size={28} color={colors.ink} />}
      title="No completed bookings yet."
      body="Bookings you've finished or cancelled show up here."
    />
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  head: { paddingHorizontal: 20, paddingBottom: space.md, gap: space.lg },
  title: { fontSize: 27, fontWeight: "700", color: colors.ink, letterSpacing: -0.5 },
  tabs: { flexDirection: "row", gap: 4, backgroundColor: colors.canvas, borderRadius: 10, padding: 4 },
  tab: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  tabOn: { backgroundColor: colors.surface },
  tabText: { fontSize: 14, fontWeight: "600", color: colors.inkMuted },
  tabTextOn: { color: colors.ink },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#16a34a" },
  body: { paddingHorizontal: 20, paddingTop: space.sm, paddingBottom: 24, gap: space.md },
  loading: { paddingVertical: space.xxl },
});
