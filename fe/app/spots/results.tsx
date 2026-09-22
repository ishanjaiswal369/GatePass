import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, spotsApi } from "@/api";
import {
  Button,
  ErrorNotice,
  PhoneFrame,
  RestoringScreen,
  SectionHeader,
  SpotListItem,
} from "@/components/ui";
import { useSession } from "@/providers/SessionProvider";
import {
  describeCriteria,
  fromParams,
  type SearchCriteria,
} from "@/lib/searchCriteria";
import { colors, space, type } from "@/theme";
import type { NearbySpot } from "@/types/api.types";

/** Widened once, not repeatedly: a driver who will not walk 5km rarely walks 10. */
const RADIUS_KM = 5;
const WIDER_RADIUS_KM = 15;

/**
 * What the search found.
 *
 * The criteria arrive as query params rather than through a provider, because
 * this is exactly the screen a driver reloads, shares or reaches from history
 * -- and state held in memory survives none of those. Unreadable params are
 * treated as no search at all rather than as a partial one, which would
 * quietly answer a different question than the driver asked.
 */
export default function SpotResultsScreen() {
  const { token, isRestoring } = useSession();
  const params = useLocalSearchParams();

  const [spots, setSpots] = useState<NearbySpot[] | null>(null);
  const [radiusKm, setRadiusKm] = useState(RADIUS_KM);
  const [error, setError] = useState<string | null>(null);

  const criteria = fromParams(params as Record<string, string | string[] | undefined>);

  const load = useCallback(
    async (within: number, search: SearchCriteria) => {
      if (!token) return;

      setSpots(null);
      setError(null);

      try {
        const { spots: found } = await spotsApi.nearby(token, {
          latitude: search.place.latitude,
          longitude: search.place.longitude,
          radiusKm: within,
          ...(search.mode === "hourly"
            ? {
                at: search.from,
                durationMinutes: Math.round(
                  (Date.parse(search.to) - Date.parse(search.from)) / 60_000
                ),
              }
            : {
                days: search.days,
                startMinute: search.startMinute,
                endMinute: search.endMinute,
              }),
        });

        setSpots(found);
      } catch (err) {
        setSpots([]);
        setError(
          err instanceof ApiError ? err.message : "Could not search for spots"
        );
      }
    },
    [token]
  );

  useEffect(() => {
    if (!criteria || !token) return;
    void load(radiusKm, criteria);
    // The criteria come from a frozen URL, so re-running on the object itself
    // would loop: it is a new object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, radiusKm, load, JSON.stringify(params)]);

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;
  if (!criteria) return <Redirect href="/home" />;

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <SectionHeader
          title={criteria.place.label}
          sub={describeCriteria(criteria)}
          onBack={() => (router.canGoBack() ? router.back() : router.replace("/home"))}
        />

        <ScrollView contentContainerStyle={s.body}>
          {error ? <ErrorNotice message={error} /> : null}

          {spots === null ? (
            <ActivityIndicator color={colors.ink} style={s.loading} />
          ) : spots.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyTitle}>No spots match this search</Text>
              <Text style={s.emptyBody}>
                {criteria.mode === "monthly"
                  ? "Nothing within range is free on every day you picked. Try fewer days, or a shorter daily window."
                  : "Nothing within range is free for those hours. Try a different time, or widen the area."}
              </Text>

              {radiusKm === RADIUS_KM ? (
                <Button
                  label={`Search within ${WIDER_RADIUS_KM} km`}
                  variant="ghost"
                  onPress={() => setRadiusKm(WIDER_RADIUS_KM)}
                />
              ) : null}

              <Button
                label="Change search"
                onPress={() =>
                  router.canGoBack() ? router.back() : router.replace("/home")
                }
              />
            </View>
          ) : (
            <>
              <Text style={s.count}>
                {spots.length === 1 ? "1 spot" : `${spots.length} spots`} within{" "}
                {radiusKm} km
              </Text>

              {spots.map((spot) => (
                <SpotListItem
                  key={spot.id}
                  name={spot.name}
                  city={spot.city}
                  distanceKm={spot.distanceKm}
                  pricePerHour={spot.pricePerHour}
                  availableUntilMinute={spot.availableUntilMinute}
                  onPress={() => router.push(`/spots/${spot.id}`)}
                />
              ))}
            </>
          )}
        </ScrollView>
      </View>
    </PhoneFrame>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  body: { padding: 20, paddingTop: space.lg, gap: space.md },
  loading: { paddingVertical: space.xxl },
  count: { ...type.caption, color: colors.inkMuted },
  empty: {
    gap: space.md,
    paddingTop: space.xl,
  },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: colors.ink },
  emptyBody: { fontSize: 14, lineHeight: 21, color: colors.inkMuted },
});
