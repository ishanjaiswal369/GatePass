import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, bookingsApi, eventsApi } from "@/api";
import {
  ActivePassCard,
  BottomNav,
  Button,
  ErrorNotice,
  EventListItem,
  HomeHeader,
  PhoneFrame,
  SegmentedControl,
  type NavKey,
  RestoringScreen,
} from "@/components/ui";
import { BookParkingForm } from "@/features/search/BookParkingForm";
import { useSession } from "@/providers/SessionProvider";
import { toParams, type SearchCriteria } from "@/lib/searchCriteria";
import { colors, radius, space, type } from "@/theme";
import type { BookingRow, EventFeedItem } from "@/types/api.types";

/**
 * Two questions a driver arrives with, and nothing else.
 *
 * "Am I parked?" -- the pass they need at the gate, right now. And "where do
 * I park?" -- a search, not a feed: hourly or monthly, somewhere, between some
 * times. The old screen led with a browsable list of events, which answered
 * neither and buried the pass behind a tab.
 *
 * The Bookings tab keeps the full history. This screen only ever shows the
 * booking a driver is on, because that is the one they need without scrolling.
 */

type Tab = "parked" | "book";

const TABS = [
  { value: "parked" as const, label: "Already parked" },
  { value: "book" as const, label: "Book parking" },
];

function passWhen(eventDate: string | null): string {
  if (!eventDate) return "Any time";

  const date = new Date(eventDate);
  const time = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  const days = Math.round((date.getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return `Today · ${time}`;
  if (days === 1) return `Tomorrow · ${time}`;
  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })} · ${time}`;
}

export default function HomeScreen() {
  const { token, user, isRestoring } = useSession();

  const [tab, setTab] = useState<Tab>("book");
  const [pass, setPass] = useState<BookingRow | null>(null);
  const [passLoaded, setPassLoaded] = useState(false);
  const [events, setEvents] = useState<EventFeedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * A driver who is already parked lands on their pass, but only until they
   * say otherwise. Switching tabs by hand sets this, so the answer arriving
   * late cannot pull the screen out from under someone already reading the
   * other one.
   */
  const chosenByHand = useRef(false);

  const chooseTab = (next: Tab) => {
    chosenByHand.current = true;
    setTab(next);
  };

  /**
   * On focus rather than on mount: this screen stays mounted under the
   * booking flow and the pass screen, so a booking made and paid for would
   * otherwise not appear until the app restarted.
   */
  useFocusEffect(
    useCallback(() => {
      if (!token) return;

      let cancelled = false;

      bookingsApi
        .active(token)
        .then(({ booking }) => {
          if (cancelled) return;
          setPass(booking);
          if (booking && !chosenByHand.current) setTab("parked");
        })
        // No pass is the normal state of this screen, so a failure here stays
        // quiet rather than pushing a banner over the search form.
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setPassLoaded(true);
        });

      eventsApi
        .list(token, { limit: 5 })
        .then((page) => {
          if (!cancelled) setEvents(page.items);
        })
        .catch((err) => {
          if (cancelled) return;
          setEvents([]);
          setError(err instanceof ApiError ? err.message : "Could not load events");
        });

      return () => {
        cancelled = true;
      };
    }, [token])
  );

  const navigate = (key: NavKey) => {
    if (key === "bookings") router.push("/bookings");
    if (key === "host") router.push("/host");
    if (key === "profile") router.push("/account");
  };

  const runSearch = (criteria: SearchCriteria) =>
    router.push({ pathname: "/spots/results", params: toParams(criteria) });

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  const initial = (user?.firstName ?? user?.email ?? "?").charAt(0).toUpperCase();

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <HomeHeader
          initial={initial}
          headline={
            tab === "parked" ? "Your parking right now" : "Where are you headed?"
          }
          onPressProfile={() => router.push("/account")}
        />

        <View style={s.tabs}>
          <SegmentedControl segments={TABS} value={tab} onChange={chooseTab} />
        </View>

        <ScrollView
          contentContainerStyle={s.body}
          keyboardShouldPersistTaps="handled"
        >
          {tab === "parked" ? (
            <ParkedPanel
              pass={pass}
              loaded={passLoaded}
              onBook={() => chooseTab("book")}
            />
          ) : (
            <>
              <BookParkingForm token={token} onSearch={runSearch} />

              {/* Event parking is a different product -- a dated slot at a
                  venue, not somebody's driveway by the hour -- so it sits
                  under the search rather than competing with it. It stays
                  because it is currently the only flow a driver can book end
                  to end. */}
              {events && events.length > 0 ? (
                <View style={s.events}>
                  {error ? <ErrorNotice message={error} /> : null}
                  <Text style={s.sectionTitle}>PARKING FOR AN EVENT</Text>
                  {events.map((event) => (
                    <EventListItem
                      key={event.id}
                      name={event.name}
                      venueName={event.venueName}
                      eventDate={event.eventDate}
                      minPrice={event.minPrice}
                      spotsLeft={event.spotsLeft}
                      vehicleTypes={event.vehicleTypes}
                      onPress={() => router.push(`/event/${event.id}`)}
                    />
                  ))}
                </View>
              ) : null}
            </>
          )}
        </ScrollView>

        <BottomNav active="home" onNavigate={navigate} />
      </View>
    </PhoneFrame>
  );
}

/**
 * The booking a driver is on. One, not a list: the Bookings tab owns the
 * history, and a driver at a gate is looking for a QR code, not a record.
 */
function ParkedPanel({
  pass,
  loaded,
  onBook,
}: {
  pass: BookingRow | null;
  loaded: boolean;
  onBook: () => void;
}) {
  if (!loaded) {
    return <ActivityIndicator color={colors.ink} style={s.loading} />;
  }

  if (!pass) {
    return (
      <View style={s.empty}>
        <Text style={s.emptyTitle}>You are not parked right now</Text>
        <Text style={s.emptyBody}>
          Once you book a spot, your pass appears here — ready to show at the
          gate.
        </Text>
        <Button label="Book parking" onPress={onBook} />
        <Pressable
          onPress={() => router.push("/bookings")}
          accessibilityRole="button"
          style={s.linkHit}
        >
          <Text style={s.link}>See past bookings</Text>
        </Pressable>
      </View>
    );
  }

  const listing = pass.parkingCapacity.listing;

  return (
    <>
      <ActivePassCard
        eventName={listing.name}
        venueName={listing.venueName}
        gate={pass.parkingCapacity.gate}
        vehicleType={pass.parkingCapacity.vehicleType}
        when={passWhen(listing.eventDate)}
        onShowPass={() => router.push(`/pass/${pass.id}`)}
      />

      <Pressable
        onPress={() => router.push("/bookings")}
        accessibilityRole="button"
        style={s.linkHit}
      >
        <Text style={s.link}>See all bookings</Text>
      </Pressable>
    </>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  tabs: { paddingHorizontal: 20, paddingTop: space.lg, paddingBottom: 14 },
  body: { paddingHorizontal: 20, paddingBottom: 20, gap: 18 },
  loading: { paddingVertical: space.xxl },
  events: { gap: space.md, paddingTop: space.sm },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: colors.inkMuted,
  },
  empty: {
    gap: space.md,
    backgroundColor: colors.canvas,
    borderRadius: radius.md,
    padding: space.xl,
  },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: colors.ink },
  emptyBody: { fontSize: 14, lineHeight: 21, color: colors.inkMuted },
  linkHit: { minHeight: 44, justifyContent: "center", alignItems: "center" },
  link: { ...type.label, color: colors.ink, textDecorationLine: "underline" },
});
