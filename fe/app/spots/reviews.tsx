import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, spotsApi } from "@/api";
import type { ReviewStarsFilter } from "@/api/spots.api";
import { Button, EmptyState, ErrorNotice, PhoneFrame, RestoringScreen, ScreenHeader, StarIcon } from "@/components/ui";
import { RatingSummaryView } from "@/features/reviews/RatingSummaryView";
import { ReviewItem } from "@/features/reviews/ReviewItem";
import { useSession } from "@/providers/SessionProvider";
import { colors, space } from "@/theme";
import type { RatingSummary, SpotReview } from "@/types/api.types";

const CHIPS: { key: ReviewStarsFilter | null; label: string }[] = [
  { key: null, label: "All" },
  { key: "5", label: "5 ★" },
  { key: "4", label: "4 ★" },
  { key: "low", label: "3 ★ and below" },
];

/**
 * Every review of one spot, newest first, under the summary the detail screen
 * shows. The chips filter the list only; the summary keeps describing all of
 * them. Paged with "Show more" rather than an endless scroll: the list is
 * read, not browsed, and a button keeps the end of the screen reachable.
 *
 * `?id=` like the checkout, rather than a nested route under the spot.
 */
export default function SpotReviewsScreen() {
  const { token, isRestoring } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [name, setName] = useState<string | null>(null);
  const [summary, setSummary] = useState<RatingSummary | null>(null);
  const [stars, setStars] = useState<ReviewStarsFilter | null>(null);
  const [items, setItems] = useState<SpotReview[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (after?: string) => {
      if (!token || !id) return;
      try {
        const page = await spotsApi.reviews(token, id, { cursor: after, stars: stars ?? undefined });
        setName(page.spot.name);
        if (page.summary) setSummary(page.summary);
        setItems((current) => (after && current ? [...current, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setError(null);
      } catch (err) {
        setError(
          err instanceof ApiError && err.status === 404 ? "This spot is no longer available." : "Could not load the reviews."
        );
      }
    },
    [token, id, stars]
  );

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  const back = () =>
    router.canGoBack() ? router.back() : id ? router.replace({ pathname: "/spots/[id]", params: { id } }) : router.replace("/home");

  const more = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    await load(cursor);
    setLoadingMore(false);
  };

  const noneAtAll = summary !== null && summary.count === 0;

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader title={name ? `Reviews · ${name}` : "Reviews"} onBack={back} />

        <ScrollView contentContainerStyle={s.body}>
          {error ? <ErrorNotice message={error} /> : null}

          {noneAtAll ? (
            <EmptyState
              icon={<StarIcon size={26} filled={false} />}
              title="No reviews yet"
              body="Drivers who park here can rate it after their stay."
            />
          ) : (
            <>
              {summary ? <RatingSummaryView summary={summary} /> : null}

              <View style={s.chips} accessibilityRole="tablist">
                {CHIPS.map((chip) => {
                  const on = stars === chip.key;
                  return (
                    <Pressable
                      key={chip.label}
                      onPress={() => setStars(chip.key)}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: on }}
                      style={[s.chip, on && s.chipOn]}
                    >
                      <Text style={[s.chipText, on && s.chipTextOn]}>{chip.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {items === null ? (
                error ? null : <ActivityIndicator color={colors.ink} style={s.loading} />
              ) : items.length === 0 ? (
                <Text style={s.none}>No reviews with that rating.</Text>
              ) : (
                <View>
                  {items.map((review) => (
                    <ReviewItem key={review.id} review={review} />
                  ))}
                </View>
              )}
              {cursor ? <Button label="Show more" variant="ghost" onPress={more} busy={loadingMore} /> : null}
            </>
          )}

          <Text style={s.rule}>
            Only drivers who completed a paid booking here can leave a review. Hosts can't edit or remove reviews.
          </Text>
        </ScrollView>
      </View>
    </PhoneFrame>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  body: { padding: 20, gap: space.lg, paddingBottom: 32 },
  loading: { paddingVertical: space.xxl },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: "center", backgroundColor: colors.canvas },
  chipOn: { backgroundColor: colors.ink },
  chipText: { fontSize: 13, fontWeight: "600", color: "#374151" },
  chipTextOn: { color: colors.onInk },
  none: { fontSize: 14, color: colors.inkMuted, textAlign: "center", paddingVertical: space.lg },
  rule: { fontSize: 12, lineHeight: 18, color: colors.inkMuted, textAlign: "center" },
});
