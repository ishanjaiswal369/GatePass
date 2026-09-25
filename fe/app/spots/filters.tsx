import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, PhoneFrame, RestoringScreen, ScreenHeader } from "@/components/ui";
import type { Amenity } from "@/constants/enums";
import { fromParams, toParams } from "@/lib/searchCriteria";
import {
  activeFilterCount,
  filtersFromParams,
  filtersToParams,
  NO_FILTERS,
  RADIUS_CHOICES,
  RATING_CHOICES,
  type SearchFilters,
} from "@/lib/searchFilters";
import { AMENITY_LABELS, SPACE_LABELS } from "@/lib/spotLabels";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space } from "@/theme";
import type { SpaceType } from "@/types/api.types";

const PRICE_CAPS = [30, 50, 100];
const TYPES: SpaceType[] = ["DRIVEWAY", "GARAGE", "CAR_PARK", "OTHER"];
const FEATURES: Amenity[] = ["COVERED", "SECURITY_GUARD", "CCTV", "EV_CHARGING", "WELL_LIT", "WASHROOM"];

/**
 * Narrowing a search.
 *
 * Edits a copy, and only "Show results" applies it -- a filter that re-ran the
 * search on every tap would make the list jump under the driver's thumb. The
 * result goes back into the URL of the results screen already on the stack,
 * rather than stacking a second one.
 *
 * A rating floor hides unrated spots, and the screen says so: a filter that
 * silently drops every new listing would read as "nothing nearby".
 */
export default function FiltersScreen() {
  const { token, isRestoring } = useSession();
  const params = useLocalSearchParams() as Record<string, string | string[] | undefined>;
  const criteria = fromParams(params);
  const [draft, setDraft] = useState<SearchFilters>(() => filtersFromParams(params));

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;
  if (!criteria) return <Redirect href="/home" />;

  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  const apply = () =>
    router.navigate({ pathname: "/spots/results", params: { ...toParams(criteria), ...filtersToParams(draft) } });

  const count = activeFilterCount(draft);

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader title="Filters" onBack={() => (router.canGoBack() ? router.back() : apply())} />

        <ScrollView contentContainerStyle={s.body}>
          <Section title="PRICE PER HOUR">
            <Chips
              items={[{ key: "any", label: "Any price", on: draft.maxPricePerHour === null, onPress: () => setDraft({ ...draft, maxPricePerHour: null }) },
                ...PRICE_CAPS.map((cap) => ({
                  key: String(cap),
                  label: `Up to ₹${cap}`,
                  on: draft.maxPricePerHour === cap,
                  onPress: () => setDraft({ ...draft, maxPricePerHour: cap }),
                }))]}
            />
          </Section>

          <Section title="DISTANCE FROM DESTINATION">
            <Chips
              items={RADIUS_CHOICES.map((km) => ({
                key: String(km),
                label: `${km} km`,
                on: draft.radiusKm === km,
                onPress: () => setDraft({ ...draft, radiusKm: km }),
              }))}
            />
          </Section>

          <Section title="PARKING TYPE">
            <Chips
              items={TYPES.map((type) => ({
                key: type,
                label: SPACE_LABELS[type],
                on: draft.spaceTypes.includes(type),
                onPress: () => setDraft({ ...draft, spaceTypes: toggle(draft.spaceTypes, type) }),
              }))}
            />
          </Section>

          <Section title="SAFETY & FEATURES">
            {FEATURES.map((amenity) => (
              <Toggle
                key={amenity}
                label={AMENITY_LABELS[amenity]}
                on={draft.amenities.includes(amenity)}
                onPress={() => setDraft({ ...draft, amenities: toggle(draft.amenities, amenity) })}
              />
            ))}
            <Toggle
              label="24/7 access"
              sub="Open all day, every day"
              on={draft.open24x7}
              onPress={() => setDraft({ ...draft, open24x7: !draft.open24x7 })}
            />
          </Section>

          <Section title="RATING">
            <Chips
              items={[
                { key: "any", label: "Any", on: draft.minRating === null, onPress: () => setDraft({ ...draft, minRating: null }) },
                ...RATING_CHOICES.map((min) => ({
                  key: String(min),
                  label: `${min.toFixed(1)}+`,
                  on: draft.minRating === min,
                  onPress: () => setDraft({ ...draft, minRating: min }),
                })),
              ]}
            />
            {draft.minRating !== null ? <Text style={s.hint}>Spaces with no reviews yet are hidden.</Text> : null}
          </Section>

          <Section title="SORT BY">
            <Chips
              items={[
                { key: "distance", label: "Nearest", on: draft.sort === "distance", onPress: () => setDraft({ ...draft, sort: "distance" }) },
                { key: "price", label: "Lowest price", on: draft.sort === "price", onPress: () => setDraft({ ...draft, sort: "price" }) },
              ]}
            />
          </Section>
        </ScrollView>

        <View style={s.bar}>
          <Button label="Clear all" variant="ghost" onPress={() => setDraft({ ...NO_FILTERS, sort: draft.sort })} />
          <View style={s.flex}>
            <Button label={count ? `Show results · ${count} filter${count === 1 ? "" : "s"}` : "Show results"} onPress={apply} />
          </View>
        </View>
      </View>
    </PhoneFrame>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

function Chips({ items }: { items: { key: string; label: string; on: boolean; onPress: () => void }[] }) {
  return (
    <View style={s.chips}>
      {items.map((item) => (
        <Pressable
          key={item.key}
          onPress={item.onPress}
          accessibilityRole="button"
          accessibilityState={{ selected: item.on }}
          style={[s.chip, item.on && s.chipOn]}
        >
          <Text style={[s.chipText, item.on && s.chipTextOn]}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Toggle({ label, sub, on, onPress }: { label: string; sub?: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="switch" accessibilityState={{ checked: on }} style={s.toggle}>
      <View style={s.flex}>
        <Text style={s.toggleLabel}>{label}</Text>
        {sub ? <Text style={s.toggleSub}>{sub}</Text> : null}
      </View>
      <View style={[s.track, on && s.trackOn]}>
        <View style={[s.knob, on && s.knobOn]} />
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  hint: { fontSize: 12, color: colors.inkMuted },
  screen: { flex: 1, backgroundColor: colors.surface },
  body: { padding: 20, gap: space.xl, paddingBottom: 24 },
  flex: { flex: 1, gap: 2 },
  section: { gap: space.md, paddingBottom: space.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  sectionTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 1.2, color: colors.inkMuted },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
  },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontSize: 14, fontWeight: "600", color: colors.ink },
  chipTextOn: { color: colors.onInk },
  toggle: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 48 },
  toggleLabel: { fontSize: 15, fontWeight: "600", color: colors.ink },
  toggleSub: { fontSize: 12, color: colors.inkMuted },
  track: { width: 44, height: 26, borderRadius: 13, backgroundColor: "#d1d5db", justifyContent: "center" },
  trackOn: { backgroundColor: colors.ink },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.surface, marginLeft: 3 },
  knobOn: { marginLeft: 21 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: 20,
    paddingTop: space.md,
    paddingBottom: 18,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
