import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, monthlyApi } from "@/api";
import { Button, DataRow, ErrorNotice, PhoneFrame, RestoringScreen, ScreenHeader, WalletIcon } from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { formatRupees } from "@/lib/money";
import { monthsLabel, termDay, termRange } from "@/lib/monthly";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space } from "@/theme";
import type { MonthlyCancellationQuote, MonthlyReservation } from "@/types/api.types";

const REASONS = ["Plans changed", "Found other parking", "Booked by mistake", "Something else"];

/**
 * Cancelling a monthly term, with the refund stated before the driver
 * commits. The amount is the server's quote -- the policy the cancellation
 * applies -- so the screen never promises money the policy doesn't give.
 */
export default function CancelMonthlyScreen() {
  const { token, isRestoring } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [row, setRow] = useState<MonthlyReservation | null>(null);
  const [quote, setQuote] = useState<MonthlyCancellationQuote | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !id) return;
    Promise.all([monthlyApi.get(token, id), monthlyApi.cancellation(token, id)])
      .then(([r, q]) => {
        setRow(r);
        setQuote(q);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Could not load the cancellation details."));
  }, [token, id]);

  const { run: confirm, busy, error } = useAsyncAction(async () => {
    if (!token || !id) return;
    await monthlyApi.cancel(token, id, reason ?? undefined);
    // Replace, so Back from the cancelled reservation doesn't land here again.
    router.replace({ pathname: "/monthly/[id]", params: { id } });
  });

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  const back = () => (router.canGoBack() ? router.back() : router.replace("/bookings"));
  const paid = row?.payment?.status === "CAPTURED" ? row.payment.amount : null;

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader title="Cancel reservation" onBack={back} />

        <ScrollView contentContainerStyle={s.body}>
          {loadError ? <ErrorNotice message={loadError} /> : null}

          {!row || !quote ? (
            loadError ? null : <ActivityIndicator color={colors.ink} style={s.loading} />
          ) : !quote.cancellable ? (
            <View style={s.blocked}>
              <Text style={s.blockedTitle}>This reservation can't be cancelled</Text>
              <Text style={s.blockedBody}>{quote.reason}</Text>
              <Button label="Back to reservation" onPress={back} />
            </View>
          ) : (
            <>
              <View style={s.gap6}>
                <Text style={s.title}>Cancel this monthly reservation?</Text>
                <Text style={s.muted}>
                  {row.listing.name} · {termRange(row.startDate, row.lastDate, row.months)}
                </Text>
              </View>

              <View style={s.card}>
                {quote.rule === "NOTHING_PAID" ? (
                  <>
                    <Text style={s.cardTitle}>Nothing to refund</Text>
                    <Text style={s.muted}>
                      This reservation hasn't been paid for, so cancelling just releases the days for someone else.
                    </Text>
                  </>
                ) : (
                  <>
                    <View style={s.refundRow}>
                      <Text style={s.cardTitle}>Refund amount</Text>
                      <Text style={s.refund}>{formatRupees(quote.refundAmount)}</Text>
                    </View>
                    {paid ? <DataRow label="You paid" value={formatRupees(paid)} /> : null}
                    <Text style={s.rule}>
                      {quote.rule === "FULL"
                        ? `Full refund: you're cancelling before the term starts on ${termDay(row.startDate)}.`
                        : `The parking for ${monthsLabel(quote.unusedMonths ?? 0)} not yet started comes back (${formatRupees(
                            row.pricePerMonth
                          )} a month). The month you're in and the platform fee aren't refunded.`}
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
                <Button label="Keep Reservation" variant="ghost" onPress={back} />
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
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.lg, gap: space.sm },
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
