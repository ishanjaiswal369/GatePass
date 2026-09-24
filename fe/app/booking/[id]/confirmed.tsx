import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, bookingsApi } from "@/api";
import {
  Button,
  CheckIcon,
  DataRow,
  ErrorNotice,
  NavigateIcon,
  PhoneFrame,
  PinIcon,
  RestoringScreen,
} from "@/components/ui";
import { AccessCard } from "@/features/bookings/AccessCard";
import { useScreenInsets } from "@/hooks/useScreenInsets";
import { bookingListing, bookingRef, clockTime, directionsUrl } from "@/lib/booking";
import { formatRupees } from "@/lib/money";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space } from "@/theme";
import type { BookingDetail } from "@/types/api.types";

/**
 * The moment after paying: proof it worked, and everything needed to get
 * there -- the address, the way in, directions -- without another tap.
 *
 * Shown only for a booking the API calls CONFIRMED. Anything else goes to the
 * booking itself, which says honestly where it stands; this screen never
 * celebrates a payment the server hasn't seen.
 */
export default function BookingConfirmedScreen() {
  const { token, isRestoring } = useSession();
  const insets = useScreenInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !id) return;
    bookingsApi
      .get(token, id)
      .then((found) => {
        if (found.status !== "CONFIRMED") {
          router.replace({ pathname: "/booking/[id]", params: { id } });
          return;
        }
        setBooking(found);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this booking."));
  }, [token, id]);

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  const listing = booking ? bookingListing(booking) : null;
  const directions = directionsUrl(listing);
  const paid = booking?.payment?.status === "CAPTURED" ? booking.payment.amount : null;

  return (
    <PhoneFrame>
      <ScrollView contentContainerStyle={[s.body, { paddingTop: insets.top + 32 }]}>
        {error ? <ErrorNotice message={error} /> : null}

        {!booking ? (
          error ? null : <ActivityIndicator color={colors.ink} style={s.loading} />
        ) : (
          <>
            <View style={s.hero}>
              <View style={s.tick}>
                <CheckIcon size={34} color="#166534" />
              </View>
              <Text style={s.title} accessibilityRole="header">
                Booking Confirmed
              </Text>
              <Text style={s.ref}>Booking ID: {bookingRef(booking.id)}</Text>
            </View>

            <View style={s.card}>
              <DataRow label="Parking" value={listing?.name} />
              {booking.startsAt ? (
                <DataRow
                  label="Date"
                  value={new Date(booking.startsAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                />
              ) : null}
              {booking.startsAt ? <DataRow label="Start" value={clockTime(booking.startsAt)} /> : null}
              {booking.endsAt ? <DataRow label="End" value={clockTime(booking.effectiveEndsAt ?? booking.endsAt)} /> : null}
              <DataRow label="Vehicle" value={booking.vehicleNumber} />
              <DataRow label="Amount paid" value={paid ? formatRupees(paid) : "—"} />
            </View>

            {listing?.addressLine || listing?.city ? (
              <View style={s.location}>
                <PinIcon size={20} color={colors.ink} />
                <Text style={s.address}>{[listing?.addressLine, listing?.city].filter(Boolean).join(", ")}</Text>
              </View>
            ) : null}

            <AccessCard instructions={booking.access?.accessInstructions ?? null} released={booking.access !== null} />

            <Text style={s.remind}>We'll remind you 30 minutes before your parking starts.</Text>

            <View style={s.gap}>
              {directions ? (
                <Button
                  label="Get Directions"
                  size="lg"
                  icon={<NavigateIcon size={17} color={colors.onPrimary} />}
                  onPress={() => void Linking.openURL(directions)}
                />
              ) : null}
              <Button
                label="View Booking"
                variant="ghost"
                onPress={() => router.replace({ pathname: "/booking/[id]", params: { id: booking.id } })}
              />
            </View>
          </>
        )}
      </ScrollView>
    </PhoneFrame>
  );
}

const s = StyleSheet.create({
  body: { padding: 20, gap: space.lg, paddingBottom: 32 },
  loading: { paddingVertical: space.xxl },
  hero: { alignItems: "center", gap: space.sm },
  tick: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#dcfce7", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 25, fontWeight: "700", color: colors.ink },
  ref: { fontSize: 14, fontWeight: "700", color: colors.ink, backgroundColor: colors.canvas, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, overflow: "hidden" },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  location: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  address: { flex: 1, fontSize: 15, lineHeight: 22, color: colors.ink },
  remind: { fontSize: 13, color: colors.inkMuted, textAlign: "center" },
  gap: { gap: space.sm },
});
