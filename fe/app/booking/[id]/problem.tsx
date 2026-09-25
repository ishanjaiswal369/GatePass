import { Redirect, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, bookingsApi, problemsApi, spotsApi } from "@/api";
import {
  Button,
  ChatIcon,
  ErrorNotice,
  PhoneFrame,
  PhoneIcon,
  RestoringScreen,
  ScreenHeader,
  SearchIcon,
  SpotCover,
  StatusChip,
  Timeline,
  type TimelineStep,
} from "@/components/ui";
import { supportMailto } from "@/constants/support";
import { PROBLEM_LABELS } from "@/features/bookings/problemLabels";
import { bookingListing, bookingRef, bookingTotal, clockTime, dateTime } from "@/lib/booking";
import { distanceLabel } from "@/lib/geo";
import { formatRupees, rateLine } from "@/lib/money";
import { toParams } from "@/lib/searchCriteria";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space } from "@/theme";
import type { BookingDetail, NearbySpot, ProblemReport } from "@/types/api.types";

/** How long an alternative is sought for: the rest of this stay, at least an hour. */
function alternativeStay(booking: BookingDetail): { from: string; to: string } {
  const now = Date.now();
  const from = new Date(Math.ceil(now / (15 * 60_000)) * 15 * 60_000);
  const end = Date.parse(booking.effectiveEndsAt ?? booking.endsAt ?? "") || 0;
  const to = new Date(Math.max(end, from.getTime() + 60 * 60_000));
  return { from: from.toISOString(), to: to.toISOString() };
}

/**
 * After a report: what happens next, who to reach, and somewhere else to park.
 *
 * The alternatives are an ordinary search around the booked space, from now
 * until this stay would have ended, with the booked space left out -- the
 * same results a driver would get searching by hand, two of them up front.
 * A new booking is its own booking; the refund decision on this one doesn't
 * depend on it.
 */
export default function ProblemStatusScreen() {
  const { token, isRestoring } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [report, setReport] = useState<ProblemReport | null>(null);
  const [nearby, setNearby] = useState<NearbySpot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !id) return;
    try {
      const [b, r] = await Promise.all([bookingsApi.get(token, id), problemsApi.get(token, id)]);
      setBooking(b);
      setReport(r);
      setError(null);

      const listing = bookingListing(b);
      if (r.status === "OPEN" && listing?.latitude && listing.longitude) {
        const stay = alternativeStay(b);
        const { spots } = await spotsApi.nearby(token, {
          latitude: Number(listing.latitude),
          longitude: Number(listing.longitude),
          radiusKm: 5,
          at: stay.from,
          durationMinutes: Math.round((Date.parse(stay.to) - Date.parse(stay.from)) / 60_000),
          vehicleType: b.vehicleType ?? undefined,
          limit: 5,
        });
        setNearby(spots.filter((spot) => spot.id !== listing.id).slice(0, 2));
      }
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? "There's no report for this booking." : "Could not load your report.");
    }
  }, [token, id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  const back = () => (router.canGoBack() ? router.back() : router.replace({ pathname: "/booking/[id]", params: { id: id ?? "" } }));
  const listing = booking ? bookingListing(booking) : null;
  const open = report?.status === "OPEN";
  const mail = booking ? supportMailto(`Problem with booking ${bookingRef(booking.id)}`) : null;
  const paid = booking?.payment?.status === "CAPTURED" ? booking.payment.amount : booking ? bookingTotal(booking) : "0";

  const steps: TimelineStep[] = report
    ? [
        { title: "Your report is logged", sub: "The host has been alerted", state: "done" },
        {
          title: "Support reviews it",
          sub: open ? "Usually within 30 minutes during the day" : report.resolvedAt ? dateTime(report.resolvedAt) : null,
          state: open ? "next" : "done",
        },
        open
          ? { title: "Refund decision", sub: `If you couldn't use the space, you'll get ${formatRupees(paid)} back`, state: "todo" }
          : report.refunded
            ? { title: `Refund of ${formatRupees(booking?.refund?.amount ?? paid)} started`, sub: "Back to how you paid, usually in 5–7 working days", state: "done" }
            : { title: "Closed without a refund", sub: report.resolutionNote, state: "done" },
      ]
    : [];

  const search = () => {
    if (!booking || !listing?.latitude || !listing.longitude) return router.push("/home");
    router.push({
      pathname: "/spots/results",
      params: toParams({
        mode: "hourly",
        place: { latitude: Number(listing.latitude), longitude: Number(listing.longitude), label: `Near ${listing.name}` },
        ...alternativeStay(booking),
      }),
    });
  };

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader
          title={report && !open ? "Report resolved" : "We're on it"}
          sub={booking && report ? `Booking ${bookingRef(booking.id)} · reported at ${clockTime(report.createdAt)}` : null}
          onBack={back}
        />

        <ScrollView contentContainerStyle={s.body}>
          {error ? <ErrorNotice message={error} /> : null}

          {!booking || !report ? (
            error ? null : <ActivityIndicator color={colors.ink} style={s.loading} />
          ) : (
            <>
              <View style={s.statusRow}>
                <StatusChip label={open ? "Under review" : report.refunded ? "Refunded" : "Resolved"} tone={open ? "danger" : "success"} />
                <Text style={s.muted}>{PROBLEM_LABELS[report.category]}</Text>
              </View>

              <View style={s.card}>
                <Text style={s.label}>WHAT HAPPENS NEXT</Text>
                <Timeline steps={steps} />
              </View>

              <View style={s.contact}>
                <Button
                  label="Contact Support"
                  variant="ghost"
                  leadingIcon={<ChatIcon size={17} />}
                  disabled={!mail}
                  onPress={() => mail && void Linking.openURL(mail)}
                />
                <Button label="Contact Host" variant="ghost" leadingIcon={<PhoneIcon size={17} />} disabled onPress={() => undefined} />
              </View>
              <Text style={s.fine}>
                Calls to the host go through a masked number, which isn't available yet.
                {mail ? "" : " Support email isn't set up in this build."}
              </Text>

              {open ? (
                <View style={s.gap10}>
                  <Text style={s.label}>CAN'T USE THIS PARKING?</Text>
                  <Button label="Find Alternative Parking" size="lg" icon={<SearchIcon size={18} color={colors.onPrimary} />} onPress={search} />
                  {nearby === null ? null : nearby.length === 0 ? (
                    <Text style={s.muted}>Nothing else is free near here right now. Try a wider search.</Text>
                  ) : (
                    nearby.map((spot) => (
                      <View key={spot.id} style={s.alt}>
                        <SpotCover url={spot.coverPhotoUrl} style={s.thumb} />
                        <View style={s.flex}>
                          <Text style={s.altName} numberOfLines={1}>
                            {spot.name}
                          </Text>
                          <Text style={s.small}>{distanceLabel(spot.distanceKm)} · available now</Text>
                          <Text style={s.altPrice}>{spot.stayTotal ? `${formatRupees(spot.stayTotal)} for your time` : rateLine(spot)}</Text>
                        </View>
                        <Pressable
                          onPress={() =>
                            router.push({
                              pathname: "/spots/[id]",
                              params: {
                                id: spot.id,
                                ...toParams({
                                  mode: "hourly",
                                  place: { latitude: Number(listing!.latitude), longitude: Number(listing!.longitude), label: `Near ${listing!.name}` },
                                  ...alternativeStay(booking),
                                }),
                              },
                            })
                          }
                          accessibilityRole="button"
                          accessibilityLabel={`Book ${spot.name}`}
                          style={s.book}
                        >
                          <Text style={s.bookText}>Book</Text>
                        </Pressable>
                      </View>
                    ))
                  )}
                  <Text style={s.fine}>
                    A new booking is separate and yours to keep. If support confirms this space couldn't be used, this
                    booking is refunded to your original payment method.
                  </Text>
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      </View>
    </PhoneFrame>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  body: { padding: 20, gap: 14, paddingBottom: 24 },
  loading: { paddingVertical: space.xxl },
  statusRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  muted: { fontSize: 13, color: colors.inkMuted },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.lg, gap: space.md },
  label: { fontSize: 12, fontWeight: "700", letterSpacing: 1.2, color: colors.inkMuted },
  contact: { gap: space.sm },
  flex: { flex: 1, gap: 3 },
  fine: { fontSize: 12, lineHeight: 18, color: colors.inkMuted },
  gap10: { gap: 10 },
  alt: { flexDirection: "row", alignItems: "center", gap: space.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 10 },
  thumb: { width: 64, height: 64, borderRadius: radius.sm, overflow: "hidden" },
  altName: { fontSize: 15, fontWeight: "600", color: colors.ink },
  small: { fontSize: 12, color: colors.inkMuted },
  altPrice: { fontSize: 13, fontWeight: "700", color: colors.ink },
  book: { minHeight: 44, paddingHorizontal: 16, borderRadius: radius.sm, backgroundColor: colors.ink, justifyContent: "center" },
  bookText: { fontSize: 14, fontWeight: "600", color: colors.onInk },
});
