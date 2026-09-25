import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, spotsApi } from "@/api";
import { Button, EmptyState, ErrorNotice, PhoneFrame, RestoringScreen, ScreenHeader, StarIcon } from "@/components/ui";
import { RatingSummaryView } from "@/features/reviews/RatingSummaryView";
import { ReviewItem } from "@/features/reviews/ReviewItem";
import { useSession } from "@/providers/SessionProvider";
import { colors, space } from "@/theme";
import type { RatingSummary, SpotReview } from "@/types/api.types";

/**
 * Every review of one spot, newest first, under the same summary the detail
 * screen shows. Paged with "Show more" rather than an endless scroll: the
 * list is read, not browsed, and a button keeps the screen's end reachable.
 *
 * `?id=` like the checkout, rather than a nested route under the spot.
 */
export default function SpotReviewsScreen() {
  const { token, isRestoring } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [summary, setSummary] = useState<RatingSummary | null>(null);
  const [items, setItems] = useState<SpotReview[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (after?: string) => {
      if (!token || !id) return;
      try {
        const page = await spotsApi.reviews(token, id, after);
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
    [token, id]
  );

  useEffect(() => {
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

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader title="Reviews" onBack={back} />

        <ScrollView contentContainerStyle={s.body}>
          {error ? <ErrorNotice message={error} /> : null}

          {items === null ? (
            error ? null : <ActivityIndicator color={colors.ink} style={s.loading} />
          ) : items.length === 0 ? (
            <EmptyState icon={<StarIcon size={26} filled={false} />} title="No reviews yet" body="Drivers who park here can rate it after their stay." />
          ) : (
            <>
              {summary ? <RatingSummaryView summary={summary} /> : null}
              <View>
                {items.map((review) => (
                  <ReviewItem key={review.id} review={review} />
                ))}
              </View>
              {cursor ? <Button label="Show more" variant="ghost" onPress={more} busy={loadingMore} /> : null}
              {!cursor && items.length > 3 ? <Text style={s.end}>That's every review.</Text> : null}
            </>
          )}
        </ScrollView>
      </View>
    </PhoneFrame>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  body: { padding: 20, gap: space.lg, paddingBottom: 32 },
  loading: { paddingVertical: space.xxl },
  end: { fontSize: 13, color: colors.inkMuted, textAlign: "center" },
});
