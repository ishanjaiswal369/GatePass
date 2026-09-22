import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, spotsApi } from "@/api";
import {
  ArrowRightIcon,
  Button,
  DataRow,
  ErrorNotice,
  PhoneFrame,
  RestoringScreen,
  SectionHeader,
  formatMinute,
} from "@/components/ui";
import { useSession } from "@/providers/SessionProvider";
import { describeCriteria, fromParams } from "@/lib/searchCriteria";
import { colors, radius, space, type } from "@/theme";
import type { AvailabilityWindow, PublicSpot } from "@/types/api.types";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function spaceTypeLabel(spaceType: string | null): string {
  if (spaceType === "DRIVEWAY") return "Driveway";
  if (spaceType === "GARAGE") return "Garage";
  if (spaceType === "CAR_PARK") return "Car park bay";
  return "Parking space";
}

/**
 * A host's spot, for a driver deciding whether to take it.
 *
 * Everything here is what the host published and an admin cleared. What is
 * absent is as deliberate: no access instructions, because those are worth
 * money and arrive with a paid booking, and no host name or contact, because
 * a driver does not need to know whose driveway it is to park in it.
 */
export default function SpotDetailScreen() {
  const { token, isRestoring } = useSession();
  const params = useLocalSearchParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  // The search that led here, if there was one. A shared link or a reload
  // carries it; a deep link into the app may not, and then there are no hours
  // to book and the screen says so rather than guessing some.
  const criteria = fromParams(
    params as Record<string, string | string[] | undefined>
  );

  const [spot, setSpot] = useState<PublicSpot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !id) return;

    try {
      setSpot(await spotsApi.getById(token, id));
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? "This spot is no longer available."
          : "Could not load this spot."
      );
    }
  }, [token, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  const address = spot
    ? [spot.addressLine, spot.city, spot.pincode].filter(Boolean).join(", ")
    : "";

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <SectionHeader
          title={spot?.name ?? "Parking spot"}
          sub={spot ? spaceTypeLabel(spot.spaceType) : undefined}
          onBack={() => (router.canGoBack() ? router.back() : router.replace("/home"))}
        />

        <ScrollView contentContainerStyle={s.body}>
          {error ? <ErrorNotice message={error} /> : null}

          {!spot ? (
            error ? null : <ActivityIndicator color={colors.ink} style={s.loading} />
          ) : (
            <>
              {spot.photos.length > 0 ? (
                <Image
                  source={{ uri: spot.photos[0].url }}
                  style={s.cover}
                  resizeMode="cover"
                />
              ) : null}

              {spot.pricing.length > 0 ? (
                <View style={s.rates}>
                  {spot.pricing.map((rate) => (
                    <View key={rate.id} style={s.rate}>
                      <Text style={s.ratePrice}>₹{Number(rate.pricePerHour)}</Text>
                      <Text style={s.rateUnit}>
                        per hour · {rate.vehicleType === "CAR" ? "Car" : "Bike"}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={s.card}>
                <Text style={s.cardHeading}>Where</Text>
                <Text style={s.address}>{address || spot.venueName}</Text>
              </View>

              <View style={s.card}>
                <Text style={s.cardHeading}>Open</Text>
                {spot.availability.length === 0 ? (
                  <Text style={s.muted}>No hours published.</Text>
                ) : (
                  spot.availability.map((window) => (
                    <DataRow
                      key={window.id}
                      label={DAY_LABELS[window.dayOfWeek]}
                      value={describeWindow(window)}
                    />
                  ))
                )}
              </View>

              {/* A host spot is booked for a stretch of time, so what can be
                  offered here depends entirely on whether this screen knows
                  one. Each branch says what it can do rather than showing a
                  button that would 400. */}
              {criteria?.mode === "hourly" ? (
                <View style={s.book}>
                  <Text style={s.bookWhen}>{describeCriteria(criteria)}</Text>
                  <Button
                    label="Book these hours"
                    size="lg"
                    icon={<ArrowRightIcon />}
                    onPress={() =>
                      router.push({
                        pathname: "/spots/checkout",
                        params: { id, from: criteria.from, to: criteria.to },
                      })
                    }
                  />
                </View>
              ) : criteria?.mode === "monthly" ? (
                <View style={s.notice}>
                  <Text style={s.noticeTitle}>Monthly is search only</Text>
                  <Text style={s.noticeBody}>
                    This spot is free on every day you picked, but a standing
                    reservation cannot be taken yet. Only one stay at a time,
                    by the hour.
                  </Text>
                </View>
              ) : (
                <View style={s.notice}>
                  <Text style={s.noticeTitle}>Pick your hours first</Text>
                  <Text style={s.noticeBody}>
                    A spot is booked for a stretch of time, and this link does
                    not carry one. Search for the hours you want and come back
                    through the results.
                  </Text>
                </View>
              )}

              <Button
                label="Back to results"
                variant="ghost"
                onPress={() =>
                  router.canGoBack() ? router.back() : router.replace("/home")
                }
              />
            </>
          )}
        </ScrollView>
      </View>
    </PhoneFrame>
  );
}

function describeWindow(window: AvailabilityWindow): string {
  if (window.startMinute === 0 && window.endMinute >= 1440) return "All day";
  return `${formatMinute(window.startMinute)} – ${formatMinute(window.endMinute)}`;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  body: { padding: 20, paddingTop: space.lg, gap: space.lg },
  loading: { paddingVertical: space.xxl },
  cover: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: radius.md,
    backgroundColor: colors.border,
  },
  rates: { flexDirection: "row", gap: space.md },
  rate: {
    flex: 1,
    gap: 2,
    backgroundColor: colors.canvas,
    borderRadius: radius.md,
    padding: space.lg,
  },
  ratePrice: { fontSize: 22, fontWeight: "700", color: colors.ink },
  rateUnit: { ...type.caption, color: colors.inkMuted },
  card: {
    gap: space.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
  },
  cardHeading: {
    ...type.label,
    color: colors.inkMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  address: { fontSize: 15, lineHeight: 22, color: colors.ink },
  muted: { fontSize: 14, color: colors.inkMuted },
  book: { gap: space.sm },
  bookWhen: {
    ...type.label,
    color: colors.inkMuted,
    textAlign: "center",
  },
  notice: {
    gap: 4,
    backgroundColor: colors.devSurface,
    borderWidth: 1,
    borderColor: colors.devBorder,
    borderRadius: radius.md,
    padding: space.lg,
  },
  noticeTitle: { ...type.label, color: colors.devInk, fontSize: 15 },
  noticeBody: { fontSize: 13, lineHeight: 19, color: colors.devInk },
});
