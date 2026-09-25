import { Redirect, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, profileApi, spotsApi } from "@/api";
import {
  Button,
  ChevronLeftIcon,
  EmptyState,
  ErrorNotice,
  PhoneFrame,
  RestoringScreen,
  SearchIcon,
  SlidersIcon,
  SpotListItem,
} from "@/components/ui";
import type { VehicleType } from "@/constants/enums";
import { ResultsMap } from "@/features/search/ResultsMap";
import { useScreenInsets } from "@/hooks/useScreenInsets";
import { formatRupees } from "@/lib/money";
import { describeCriteria, formatDuration, fromParams, toParams, type SearchCriteria } from "@/lib/searchCriteria";
import {
  activeFilterCount,
  filtersFromParams,
  filtersToAllParams,
  filtersToParams,
  NO_FILTERS,
  type SearchFilters,
} from "@/lib/searchFilters";
import { VEHICLE_LABELS } from "@/lib/spotLabels";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space } from "@/theme";
import type { NearbySpot } from "@/types/api.types";

/** Offered once when nothing is found: a driver who won't walk 5 km rarely walks 10. */
const WIDER_RADIUS_KM = 15;
const MAP_HEIGHT = 230;

/**
 * What the search found: a map and a list of the same spaces.
 *
 * The criteria and the filters arrive as query params, because this is the
 * screen a driver reloads, shares or reaches from history. Prices are for the
 * driver's default vehicle when they have one -- a car driver shown a bike
 * stand's ₹5 is being shown the wrong number.
 */
export default function SpotResultsScreen() {
  const { token, isRestoring } = useSession();
  const insets = useScreenInsets();
  const params = useLocalSearchParams() as Record<string, string | string[] | undefined>;

  const criteria = fromParams(params);
  const filters = filtersFromParams(params);
  const paramKey = JSON.stringify(params);

  const [spots, setSpots] = useState<NearbySpot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mapOn, setMapOn] = useState(true);
  const [vehicleType, setVehicleType] = useState<VehicleType | null | undefined>(undefined);

  const scroller = useRef<ScrollView>(null);
  const offsets = useRef<Record<string, number>>({});

  // The default vehicle decides which rate the cards show. `undefined` until
  // known, so the search waits for it rather than running twice.
  useEffect(() => {
    if (!token) return;
    profileApi
      .listVehicles(token)
      .then(({ vehicles }) => setVehicleType((vehicles.find((v) => v.isDefault) ?? vehicles[0])?.vehicleType ?? null))
      .catch(() => setVehicleType(null));
  }, [token]);

  const load = useCallback(
    async (search: SearchCriteria, narrow: SearchFilters, vehicle: VehicleType | null) => {
      if (!token) return;
      setSpots(null);
      setError(null);

      try {
        const { spots: found } = await spotsApi.nearby(token, {
          latitude: search.place.latitude,
          longitude: search.place.longitude,
          radiusKm: narrow.radiusKm,
          ...(search.mode === "hourly"
            ? {
                at: search.from,
                durationMinutes: Math.round((Date.parse(search.to) - Date.parse(search.from)) / 60_000),
              }
            : { days: search.days, startMinute: search.startMinute, endMinute: search.endMinute }),
          vehicleType: vehicle ?? undefined,
          amenities: narrow.amenities,
          spaceTypes: narrow.spaceTypes,
          maxPricePerHour: narrow.maxPricePerHour ?? undefined,
          open24x7: narrow.open24x7,
          minRating: narrow.minRating ?? undefined,
          sort: narrow.sort,
        });
        setSpots(found);
        setSelected(found[0]?.id ?? null);
      } catch (err) {
        setSpots([]);
        setError(err instanceof ApiError ? err.message : "Could not search for spaces");
      }
    },
    [token]
  );

  // On focus: coming back from Filters or a spot (where it may have been
  // saved) has to show the current state.
  useFocusEffect(
    useCallback(() => {
      if (!criteria || !token || vehicleType === undefined) return;
      void load(criteria, filters, vehicleType);
      // Criteria and filters are rebuilt from the URL every render.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, load, paramKey, vehicleType])
  );

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;
  if (!criteria) return <Redirect href="/home" />;

  const monthly = criteria.mode === "monthly";
  const stayMinutes = monthly ? 0 : Math.round((Date.parse(criteria.to) - Date.parse(criteria.from)) / 60_000);
  const stayLabel = `for ${formatDuration(stayMinutes)}`;
  const filterCount = activeFilterCount(filters);
  const radiusKm = filters.radiusKm;
  const setRadiusKm = (km: number) =>
    router.setParams(filtersToAllParams({ ...filters, radiusKm: km }));

  const openFilters = () =>
    router.push({ pathname: "/spots/filters", params: { ...toParams(criteria), ...filtersToParams(filters) } });

  const toggleSave = async (spot: NearbySpot) => {
    const next = !spot.saved;
    setSpots((list) => list?.map((s) => (s.id === spot.id ? { ...s, saved: next } : s)) ?? null);
    try {
      await (next ? spotsApi.save(token, spot.id) : spotsApi.unsave(token, spot.id));
    } catch {
      // Put it back: the heart must say what the server holds.
      setSpots((list) => list?.map((s) => (s.id === spot.id ? { ...s, saved: !next } : s)) ?? null);
    }
  };

  const pick = (id: string) => {
    setSelected(id);
    const y = offsets.current[id];
    if (y !== undefined) scroller.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
  };

  const setSort = (sort: SearchFilters["sort"]) =>
    router.setParams(filtersToAllParams({ ...filters, sort }));

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <View style={[s.header, { paddingTop: insets.top + 12 }]}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/home"))}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={s.back}
          >
            <ChevronLeftIcon color={colors.onInk} />
          </Pressable>
          <Pressable
            onPress={() => router.replace("/home")}
            accessibilityRole="button"
            accessibilityLabel={`Change search: ${criteria.place.label}, ${describeCriteria(criteria)}`}
            style={s.summary}
          >
            <SearchIcon size={15} color={colors.onInkMuted} />
            <View style={s.flex}>
              <Text style={s.place} numberOfLines={1}>
                {criteria.place.label}
              </Text>
              <Text style={s.when} numberOfLines={1}>
                {describeCriteria(criteria)}
              </Text>
            </View>
          </Pressable>
          <Pressable
            onPress={openFilters}
            accessibilityRole="button"
            accessibilityLabel={filterCount ? `Filters, ${filterCount} applied` : "Filters"}
            style={s.filterButton}
          >
            <SlidersIcon color={colors.onInk} />
            {filterCount ? (
              <View style={s.badge}>
                <Text style={s.badgeText}>{filterCount}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>

        {spots && spots.length > 0 && mapOn ? (
          <ResultsMap
            token={token}
            centre={criteria.place}
            height={MAP_HEIGHT}
            selectedId={selected}
            onSelect={pick}
            pins={spots.map((spot) => ({
              id: spot.id,
              latitude: spot.latitude,
              longitude: spot.longitude,
              label: monthly && spot.pricePerMonth !== null
                ? `${formatRupees(spot.pricePerMonth)}/mo`
                : `${formatRupees(spot.pricePerHour)}/hr`,
            }))}
          />
        ) : null}

        {spots && spots.length > 0 ? (
          <View style={s.toolbar}>
            <View style={s.flex}>
              <Text style={s.count}>
                {spots.length === 1 ? "1 space" : `${spots.length} spaces`} within {radiusKm} km
              </Text>
              <Text style={s.sub}>
                {vehicleType ? `Prices for your ${VEHICLE_LABELS[vehicleType].toLowerCase()}` : "Lowest price for any vehicle"}
              </Text>
            </View>
            <Pressable
              onPress={() => setSort(filters.sort === "distance" ? "price" : "distance")}
              accessibilityRole="button"
              accessibilityLabel={`Sorted by ${filters.sort === "distance" ? "distance" : "price"}. Change sort`}
              style={s.chip}
            >
              <Text style={s.chipText}>{filters.sort === "distance" ? "Nearest" : "Lowest price"}</Text>
            </Pressable>
            <Pressable onPress={() => setMapOn((on) => !on)} accessibilityRole="button" style={s.chip}>
              <Text style={s.chipText}>{mapOn ? "Hide map" : "Map"}</Text>
            </Pressable>
          </View>
        ) : null}

        <ScrollView ref={scroller} contentContainerStyle={s.body}>
          {error && spots?.length !== 0 ? <ErrorNotice message={error} /> : null}

          {spots === null ? (
            <Skeleton />
          ) : spots.length === 0 ? (
            error ? (
              <EmptyState icon={<SearchIcon size={28} color={colors.ink} />} title="Something went wrong." body={error}>
                <Button label="Retry" onPress={() => vehicleType !== undefined && void load(criteria, filters, vehicleType)} />
              </EmptyState>
            ) : (
              <EmptyState
                icon={<SearchIcon size={28} color={colors.ink} />}
                title="No parking spaces available for this time."
                body={
                  filterCount
                    ? "Nothing matches with these filters. Try removing some, a different time, or a wider area."
                    : monthly
                      ? "Nothing within range is free on every day you picked. Try fewer days or shorter hours."
                      : "Every space nearby is booked or closed for those hours. Try a different time, or look further away."
                }
              >
                <View style={s.gap}>
                  <Button label="Change Time" onPress={() => router.replace("/home")} />
                  {radiusKm < WIDER_RADIUS_KM ? (
                    <Button label={`Expand Search to ${WIDER_RADIUS_KM} km`} variant="ghost" onPress={() => setRadiusKm(WIDER_RADIUS_KM)} />
                  ) : null}
                  {filterCount ? (
                    <Button
                      label="Clear filters"
                      variant="ghost"
                      onPress={() => router.setParams(filtersToAllParams({ ...NO_FILTERS, sort: filters.sort }))}
                    />
                  ) : null}
                </View>
              </EmptyState>
            )
          ) : (
            spots.map((spot) => (
              <View key={spot.id} onLayout={(event) => (offsets.current[spot.id] = event.nativeEvent.layout.y)}>
                <SpotListItem
                  spot={spot}
                  stayLabel={stayLabel}
                  monthly={monthly}
                  selected={spot.id === selected}
                  onToggleSave={() => void toggleSave(spot)}
                  onView={() =>
                    router.push({ pathname: "/spots/[id]", params: { id: spot.id, ...toParams(criteria) } })
                  }
                />
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </PhoneFrame>
  );
}

/** Loading: the shape of the cards to come, rather than a blank screen. */
function Skeleton() {
  return (
    <View style={s.gap} accessibilityLabel="Finding parking" accessibilityRole="progressbar">
      {[0, 1].map((index) => (
        <View key={index} style={s.skeletonCard}>
          <View style={s.skeletonPhoto} />
          <View style={s.skeletonBody}>
            <View style={[s.skeletonLine, { width: "62%" }]} />
            <View style={[s.skeletonLine, { width: "40%" }]} />
            <View style={[s.skeletonLine, { width: "78%" }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const SK = "#eceef1";

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: {
    backgroundColor: colors.ink,
    paddingHorizontal: 12,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  summary: {
    flex: 1,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    backgroundColor: colors.inkRaised,
    borderWidth: 1,
    borderColor: colors.inkRaisedBorder,
  },
  flex: { flex: 1, gap: 1 },
  place: { fontSize: 15, fontWeight: "700", color: colors.onInk },
  when: { fontSize: 12, color: colors.onInkMuted },
  filterButton: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.inkRaised,
    borderWidth: 1,
    borderColor: colors.inkRaisedBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: 5,
    right: 5,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: { fontSize: 10, fontWeight: "700", color: colors.ink },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: 20,
    paddingTop: space.md,
    paddingBottom: 4,
  },
  count: { fontSize: 15, fontWeight: "700", color: colors.ink },
  sub: { fontSize: 12, color: colors.inkMuted },
  chip: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
  },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.ink },
  body: { padding: 20, paddingTop: space.md, gap: space.lg },
  gap: { gap: space.md },
  skeletonCard: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: "hidden" },
  skeletonPhoto: { height: 150, backgroundColor: SK },
  skeletonBody: { padding: 14, gap: 10 },
  skeletonLine: { height: 12, borderRadius: 6, backgroundColor: SK },
});
