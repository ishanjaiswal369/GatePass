import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, bookingsApi } from "@/api";
import {
  Button,
  DataRow,
  ErrorNotice,
  PhoneFrame,
  RestoringScreen,
  ScreenHeader,
  WalletIcon,
} from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { bookingListing, bookingWhen, dateTime } from "@/lib/booking";
import { formatRupees } from "@/lib/money";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space } from "@/theme";
import type { BookingDetail, CancellationQuote } from "@/types/api.types";

const REASONS = ["Plans changed", "Found other parking", "Booked by mistake", "Something else"];

/**
 * Cancelling, with the refund stated before the driver commits.
 *
 * The amount comes from the server's quote -- the same policy the
 * cancellation applies -- so the screen never promises money the policy
 * doesn't give. When nothing was paid it says so plainly rather than
 * showing a ₹0 refund.
 */
export default function CancelBookingScreen() {
  const { token, isRestoring } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [quote, setQuote] = useState<CancellationQuote | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !id) return;
    Promise.all([bookingsApi.get(token, id), bookingsApi.cancellation(token, id)])
      .then(([b, q]) => {
        setBooking(b);
        setQuote(q);
      })
      .catch((err) =>
        setLoadError(err instanceof ApiError ? err.message : "Could not load the cancellation details.")
      );
  }, [token, id]);

  const { run: confirm, busy, error } = useAsyncAction(async () => {
    if (!token || !id) return;
    await bookingsApi.cancel(token, id, reason ?? undefined);
    // Replace, so Back from the cancelled booking doesn't land here again.
    router.replace({ pathname: "/booking/[id]", params: { id } });
  });

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  const back = () => (router.canGoBack() ? router.back() : router.replace("/bookings"));

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader title="Cancel booking" onBack={back} />

        <ScrollView contentContainerStyle={s.body}>
          {loadError ? <ErrorNotice message={loadError} /> : null}

          {!booking || !quote ? (
            loadError ? null : <ActivityIndicator color={colors.ink} style={s.loading} />
          ) : !quote.cancellable ? (
            <View style={s.blocked}>
              <Text style={s.blockedTitle}>This booking can't be cancelled</Text>
              <Text style={s.blockedBody}>{quote.reason}</Text>
              <Button label="Back to booking" onPress={back} />
            </View>
          ) : (
            <>
              <View style={s.gap6}>
                <Text style={s.title}>Cancel this booking?</Text>
                <Text style={s.muted}>
                  {bookingListing(booking)?.name} · {bookingWhen(booking)}
                </Text>
              </View>

              <View style={s.card}>
                {quote.rule === "NOTHING_PAID" ? (
                  <>
                    <Text style={s.cardTitle}>Nothing to refund</Text>
                    <Text style={s.muted}>
                      This booking hasn't been paid for, so cancelling just releases the hours for someone else.
                    </Text>
                  </>
                ) : (
                  <>
                    <View style={s.refundRow}>
                      <Text style={s.cardTitle}>Refund amount</Text>
                      <Text style={s.refund}>{formatRupees(quote.refundAmount)}</Text>
                    </View>
                    <DataRow label="You paid" value={formatRupees(quote.paidAmount)} />
                    <Text style={s.rule}>
                      {quote.rule === "FULL"
                        ? `Full refund: you're cancelling before the free-cancellation deadline${
                            quote.freeUntil ? `, ${dateTime(quote.freeUntil)}` : ""
                          }.`
                        : "Partial refund: it's less than an hour to your start, so half the parking amount comes back. The platform fee isn't refunded."}
                    </Text>
                  </>
                )}
              </View>

              {quote.rule !== "NOTHING_PAID" ? (
                <View style={[s.card, s.row]}>
                  <WalletIcon size={20} />
                  <View style={s.flex}>
                    <Text style={s.cardTitle}>Original payment method</Text>
                    <Text style={s.muted}>Usually 5–7 working days, depending on your bank.</Text>
                  </View>
                </View>
              ) : null}

              <View style={s.gap6}>
                <Text style={s.label}>WHY ARE YOU CANCELLING? (OPTIONAL)</Text>
                <View style={s.reasons}>
                  {REASONS.map((item) => {
                    const on = reason === item;
                    return (
                      <Pressable
                        key={item}
                        onPress={() => setReason(on ? null : item)}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: on }}
                        style={[s.reason, on && s.reasonOn]}
                      >
                        <Text style={[s.reasonText, on && s.reasonTextOn]}>{item}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {error ? <ErrorNotice message={error} /> : null}

              <View style={s.gap6}>
                <Button label="Confirm Cancellation" variant="danger" size="lg" onPress={confirm} busy={busy} />
                <Button label="Keep Booking" variant="ghost" onPress={back} />
              </View>
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
  gap6: { gap: 6 },
  flex: { flex: 1, gap: 2 },
  title: { fontSize: 23, fontWeight: "700", color: colors.ink },
  muted: { fontSize: 14, lineHeight: 20, color: colors.inkMuted },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.sm,
  },
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  cardTitle: { fontSize: 15, fontWeight: "700", color: colors.ink },
  refundRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  refund: { fontSize: 22, fontWeight: "700", color: "#166534" },
  rule: { fontSize: 13, lineHeight: 19, color: "#374151" },
  label: { fontSize: 12, fontWeight: "700", letterSpacing: 1.2, color: colors.inkMuted },
  reasons: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  reason: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
  },
  reasonOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  reasonText: { fontSize: 14, fontWeight: "600", color: colors.ink },
  reasonTextOn: { color: colors.onInk },
  blocked: { backgroundColor: colors.canvas, borderRadius: radius.md, padding: space.lg, gap: space.md },
  blockedTitle: { fontSize: 17, fontWeight: "700", color: colors.ink },
  blockedBody: { fontSize: 14, lineHeight: 21, color: colors.inkMuted },
});
