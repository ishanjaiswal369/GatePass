import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, spotsApi } from "@/api";
import {
  Button,
  EmptyState,
  ErrorNotice,
  HeartIcon,
  PhoneFrame,
  RatingBadge,
  RestoringScreen,
  ScreenHeader,
  SpotCover,
} from "@/components/ui";
import { formatRupees } from "@/lib/money";
import { spaceLabel } from "@/lib/spotLabels";
import { useSession } from "@/providers/SessionProvider";
import { colors, HIT_SLOP_MIN, radius, space } from "@/theme";
import type { SavedSpot } from "@/types/api.types";

/**
 * Spaces the driver saved for later.
 *
 * Removing one leaves an Undo in its place rather than making it vanish: a
 * heart is the control people tap by accident. A saved spot that stops taking
 * bookings stays listed, marked, instead of disappearing without a word.
 */
export default function SavedParkingScreen() {
  const { token, isRestoring } = useSession();
  const [spots, setSpots] = useState<SavedSpot[] | null>(null);
  const [removed, setRemoved] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const { spots: found } = await spotsApi.saved(token);
      setSpots(found);
      setRemoved({});
      setError(null);
    } catch (err) {
      setSpots([]);
      setError(err instanceof ApiError ? err.message : "Could not load your saved parking.");
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const setSaved = async (id: string, saved: boolean) => {
    if (!token) return;
    setRemoved((current) => ({ ...current, [id]: !saved }));
    try {
      await (saved ? spotsApi.save(token, id) : spotsApi.unsave(token, id));
    } catch {
      setRemoved((current) => ({ ...current, [id]: saved }));
    }
  };

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader title="Saved parking" onBack={() => (router.canGoBack() ? router.back() : router.replace("/account"))} />

        <ScrollView contentContainerStyle={s.body}>
          {error ? <ErrorNotice message={error} /> : null}

          {spots === null ? (
            <ActivityIndicator color={colors.ink} style={s.loading} />
          ) : spots.length === 0 ? (
            <EmptyState
              icon={<HeartIcon size={28} />}
              title="No saved parking yet"
              body="Save parking spaces for faster booking later. Tap the heart on any space."
            >
              <Button label="Find Parking" onPress={() => router.push("/home")} />
            </EmptyState>
          ) : (
            spots.map((spot) =>
              removed[spot.id] ? (
                <View key={spot.id} style={s.undo}>
                  <Text style={s.undoText} numberOfLines={1}>
                    Removed {spot.name}
                  </Text>
                  <Pressable onPress={() => void setSaved(spot.id, true)} accessibilityRole="button" style={s.undoButton}>
                    <Text style={s.undoAction}>Undo</Text>
                  </Pressable>
                </View>
              ) : (
                <View key={spot.id} style={[s.card, !spot.bookable && s.dim]}>
                  <SpotCover url={spot.coverPhotoUrl} style={s.thumb} />
                  <View style={s.info}>
                    <View style={s.titleRow}>
                      <Text style={s.name} numberOfLines={2}>
                        {spot.name}
                      </Text>
                      <Pressable
                        onPress={() => void setSaved(spot.id, false)}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${spot.name} from saved`}
                        style={s.heart}
                      >
                        <HeartIcon filled />
                      </Pressable>
                    </View>
                    <View style={s.metaRow}>
                      <RatingBadge rating={spot.rating} count={spot.reviewCount} />
                      <Text style={[s.muted, s.flexShrink]} numberOfLines={1}>
                        {spaceLabel(spot.spaceType)} · {spot.city}
                      </Text>
                    </View>
                    {spot.pricePerHour !== null ? (
                      <Text style={s.price}>
                        {formatRupees(spot.pricePerHour)}/hr
                        {spot.pricePerDay !== null ? ` · ${formatRupees(spot.pricePerDay)}/day` : ""}
                      </Text>
                    ) : null}
                    {spot.bookable ? (
                      <Button
                        label="View & Book"
                        variant="ghost"
                        onPress={() => router.push({ pathname: "/spots/[id]", params: { id: spot.id } })}
                      />
                    ) : (
                      <Text style={s.unavailable}>Not taking bookings right now</Text>
                    )}
                  </View>
                </View>
              )
            )
          )}
        </ScrollView>
      </View>
    </PhoneFrame>
  );
}

const s = StyleSheet.create({
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  flexShrink: { flexShrink: 1 },
  screen: { flex: 1, backgroundColor: colors.surface },
  body: { padding: 20, gap: space.md, paddingBottom: 32 },
  loading: { paddingVertical: space.xxl },
  card: { flexDirection: "row", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: "hidden" },
  dim: { opacity: 0.7 },
  thumb: { width: 108, aspectRatio: undefined },
  info: { flex: 1, padding: 12, gap: 4 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 4 },
  name: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.ink },
  heart: { width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, marginTop: -10, marginRight: -10, alignItems: "center", justifyContent: "center" },
  muted: { fontSize: 13, color: colors.inkMuted },
  price: { fontSize: 14, fontWeight: "700", color: colors.ink },
  unavailable: { fontSize: 13, fontWeight: "600", color: colors.accentInk, paddingTop: 4 },
  undo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.canvas,
    borderRadius: radius.md,
    paddingLeft: 14,
  },
  undoText: { flex: 1, fontSize: 14, color: "#374151" },
  undoButton: { minHeight: HIT_SLOP_MIN, paddingHorizontal: 14, justifyContent: "center" },
  undoAction: { fontSize: 14, fontWeight: "700", color: colors.ink, textDecorationLine: "underline" },
});
