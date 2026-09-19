import { Redirect, router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ApiError, bookingsApi, eventsApi, spotsApi } from "@/api";
import {
  ActivePassCard,
  BottomNav,
  ErrorNotice,
  EventListItem,
  HomeHeader,
  LocationPrompt,
  PhoneFrame,
  SegmentedControl,
  SpotListItem,
  type NavKey,
} from "@/components/ui";
import { useDriverLocation } from "@/hooks/useDriverLocation";
import { useSession } from "@/providers/SessionProvider";
import { colors, space } from "@/theme";
import type { BookingRow, EventFeedItem, NearbySpot } from "@/types/api.types";

type Tab = "events" | "nearby";

const TABS = [
  { value: "events" as const, label: "Events" },
  { value: "nearby" as const, label: "Nearby" },
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
  const { token, user } = useSession();
  const [tab, setTab] = useState<Tab>("events");
  const [query, setQuery] = useState("");

  const [events, setEvents] = useState<EventFeedItem[] | null>(null);
  const [pass, setPass] = useState<BookingRow | null>(null);
  const [spots, setSpots] = useState<NearbySpot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locationNote, setLocationNote] = useState<string | null>(null);

  const { coords, status: locationStatus, requestLocation } = useDriverLocation();

  /**
   * Three parallel calls rather than one aggregate endpoint: the feed is
   * shared and cacheable while the pass is per-user and must be fresh, and the
   * pass failing should not blank out discovery.
   */
  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    eventsApi
      .list(token, { limit: 20 })
      .then((page) => {
        if (!cancelled) setEvents(page.items);
      })
      .catch((err) => {
        if (!cancelled) {
          setEvents([]);
          setError(
            err instanceof ApiError ? err.message : "Could not load events"
          );
        }
      });

    bookingsApi
      .active(token)
      .then((result) => {
        if (!cancelled) setPass(result.booking);
      })
      // A missing pass is the normal state of this screen, so a failure here
      // stays silent rather than pushing an error banner over the feed.
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [token]);

  const search = useCallback(async () => {
    if (!token) return;

    try {
      const page = await eventsApi.list(token, {
        q: query.trim() || undefined,
        limit: 20,
      });
      setEvents(page.items);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not search");
    }
  }, [token, query]);

  const loadSpots = useCallback(
    async (at: { latitude: number; longitude: number }) => {
      if (!token) return;

      try {
        const result = await spotsApi.nearby(token, { ...at, radiusKm: 5 });
        setSpots(result.spots);
        setLocationNote(null);
      } catch (err) {
        setSpots([]);
        setLocationNote(
          err instanceof ApiError ? err.message : "Could not load spots"
        );
      }
    },
    [token]
  );

  const enableLocation = useCallback(async () => {
    const next = await requestLocation();
    if (next) {
      await loadSpots(next);
    } else {
      setLocationNote(
        "Location is off. You can still search an area by name above."
      );
    }
  }, [requestLocation, loadSpots]);

  const enterAreaManually = useCallback(async () => {
    if (!token) return;

    const area = query.trim();
    if (!area) {
      setLocationNote("Type an area in the search box first.");
      return;
    }

    try {
      const { results } = await spotsApi.geocode(token, area);
      const first = results[0];

      if (!first) {
        setLocationNote(`No place found for "${area}".`);
        return;
      }

      await loadSpots({ latitude: first.latitude, longitude: first.longitude });
    } catch (err) {
      setLocationNote(
        err instanceof ApiError && err.status === 503
          ? "Area search is not set up yet. Use location instead."
          : "Could not look that area up."
      );
    }
  }, [token, query, loadSpots]);

  const navigate = useCallback((key: NavKey) => {
    if (key === "bookings") router.push("/bookings");
    if (key === "host") router.push("/host");
    if (key === "profile") router.push("/account");
  }, []);

  // After every hook, so hook order never changes between renders.
  if (!token) {
    return <Redirect href="/" />;
  }

  const initial = (user?.firstName ?? user?.email ?? "?").charAt(0).toUpperCase();
  const showSpots = locationStatus === "granted" && spots !== null;

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <HomeHeader
          initial={initial}
          placeholder={
            tab === "events" ? "Search events or venues" : "Search an area"
          }
          query={query}
          onChangeQuery={setQuery}
          onSubmitQuery={tab === "events" ? search : enterAreaManually}
          onPressProfile={() => router.push("/account")}
        />

        <View style={s.tabs}>
          <SegmentedControl segments={TABS} value={tab} onChange={setTab} />
        </View>

        {tab === "events" ? (
          <ScrollView contentContainerStyle={s.body}>
            {error ? <ErrorNotice message={error} /> : null}

            {pass ? (
              <ActivePassCard
                eventName={pass.parkingCapacity.listing.name}
                venueName={pass.parkingCapacity.listing.venueName}
                gate={pass.parkingCapacity.gate}
                vehicleType={pass.parkingCapacity.vehicleType}
                when={passWhen(pass.parkingCapacity.listing.eventDate)}
                onShowPass={() => router.push(`/pass/${pass.id}`)}
              />
            ) : null}

            <View style={s.sectionHead}>
              <Text style={s.sectionTitle}>UPCOMING NEAR YOU</Text>
              <Pressable onPress={() => router.push("/bookings")} accessibilityRole="button">
                <Text style={s.seeAll}>See all</Text>
              </Pressable>
            </View>

            {events === null ? (
              <ActivityIndicator color={colors.ink} style={s.loading} />
            ) : events.length === 0 ? (
              <Text style={s.empty}>
                No events on sale right now. Pull the search box for a venue you
                know.
              </Text>
            ) : (
              <View style={s.list}>
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
            )}
          </ScrollView>
        ) : showSpots ? (
          <ScrollView contentContainerStyle={s.body}>
            {locationNote ? <ErrorNotice message={locationNote} /> : null}
            {spots.length === 0 ? (
              <Text style={s.empty}>
                No spots available around here right now. Hosts are still coming
                online.
              </Text>
            ) : (
              <View style={s.list}>
                {spots.map((spot) => (
                  <SpotListItem
                    key={spot.id}
                    name={spot.name}
                    city={spot.city}
                    distanceKm={spot.distanceKm}
                    pricePerHour={spot.pricePerHour}
                    availableUntilMinute={spot.availableUntilMinute}
                    onPress={() => router.push(`/event/${spot.id}`)}
                  />
                ))}
              </View>
            )}
          </ScrollView>
        ) : (
          <LocationPrompt
            onEnableLocation={enableLocation}
            onEnterArea={enterAreaManually}
            busy={locationStatus === "asking"}
            note={locationNote}
          />
        )}

        <BottomNav active="home" onNavigate={navigate} />
      </View>
    </PhoneFrame>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  tabs: { paddingHorizontal: 20, paddingTop: space.lg, paddingBottom: 14 },
  body: { paddingHorizontal: 20, paddingBottom: 20, gap: 18 },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: colors.inkMuted,
  },
  seeAll: { fontSize: 13, fontWeight: "700", color: colors.ink },
  list: { gap: space.md },
  loading: { paddingVertical: space.xl },
  empty: {
    fontSize: 14,
    color: colors.inkMuted,
    lineHeight: 21,
    paddingVertical: space.sm,
  },
});
