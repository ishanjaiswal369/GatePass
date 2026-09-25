import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, hostApi } from "@/api";
import { DataRow, ErrorNotice, PhoneFrame, RestoringScreen, ScreenHeader, StatusChip, type ChipTone } from "@/components/ui";
import { formatRupees } from "@/lib/money";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space } from "@/theme";
import type { HostEarnings, PayoutState } from "@/types/api.types";

const STATE: Record<PayoutState, { label: string; tone: ChipTone }> = {
  PENDING: { label: "Pending", tone: "warning" },
  AVAILABLE: { label: "Available", tone: "success" },
  PAID_OUT: { label: "Paid out", tone: "neutral" },
  NONE: { label: "No earning", tone: "neutral" },
};

/** An example stay for "How one booking splits": ₹250, as in the prototype. */
const EXAMPLE = 250;

/**
 * Earnings & payouts.
 *
 * Every number comes from the API's ledger: a host earns the parking they
 * keep (after any refund) less the commission; the driver's platform fee and
 * GST are never theirs to lose. Payouts are sent by GatePass (an admin
 * creates the settlement today), so the screen says what is available rather
 * than promising a payout date nothing schedules yet.
 */
export default function HostEarningsScreen() {
  const { token, isRestoring } = useSession();
  const [data, setData] = useState<HostEarnings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setData(await hostApi.earnings(token));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load your earnings.");
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  const rate = data?.commissionRate ?? 0.1;
  const account = data?.payoutAccount;

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader title="Earnings" onBack={() => (router.canGoBack() ? router.back() : router.replace("/host"))} />
        <ScrollView contentContainerStyle={s.body}>
          {error ? <ErrorNotice message={error} /> : null}
          {!data ? (
            error ? null : <ActivityIndicator color={colors.ink} style={s.loading} />
          ) : (
            <>
              <View style={s.hero}>
                <Text style={s.heroLabel}>Available for payout</Text>
                <Text style={s.heroValue}>{formatRupees(data.available)}</Text>
                <Text style={s.heroSub}>
                  {account?.accountNumberLast4
                    ? `Sent by GatePass to your account •• ${account.accountNumberLast4}`
                    : "Add a payout account to be paid"}
                </Text>
              </View>

              <View style={s.pair}>
                <View style={s.tile}>
                  <Text style={s.muted}>Pending</Text>
                  <Text style={s.tileValue}>{formatRupees(data.pending)}</Text>
                  <Text style={s.small}>From bookings that haven't ended yet</Text>
                </View>
                <View style={s.tile}>
                  <Text style={s.muted}>Paid out</Text>
                  <Text style={s.tileValue}>{formatRupees(data.paidOut)}</Text>
                  <Text style={s.small}>Since you started hosting</Text>
                </View>
              </View>

              <View style={s.card}>
                <Text style={s.label}>THIS MONTH · {data.month.label.toUpperCase()}</Text>
                <DataRow label="Total earnings (gross)" value={formatRupees(data.month.gross)} />
                <DataRow label={`Platform fee (${Math.round(rate * 100)}%)`} value={`− ${formatRupees(data.month.commission)}`} />
                <DataRow label="Net" value={formatRupees(data.month.net)} />
              </View>

              <View style={s.split}>
                <Text style={s.splitTitle}>How one booking splits</Text>
                <DataRow label="Driver pays for parking" value={formatRupees(EXAMPLE)} />
                <DataRow label={`GatePass commission (${Math.round(rate * 100)}%)`} value={`− ${formatRupees(EXAMPLE * rate)}`} />
                <DataRow label="You receive" value={formatRupees(EXAMPLE * (1 - rate))} />
                <Text style={s.small}>The driver's own platform fee and GST are separate and never come out of your share.</Text>
              </View>

              <Text style={s.label}>TRANSACTIONS</Text>
              {data.transactions.length === 0 ? (
                <Text style={s.muted}>No bookings yet.</Text>
              ) : (
                <View style={s.list}>
                  {data.transactions.map((t) => (
                    <View key={`${t.kind}:${t.id}`} style={s.tx}>
                      <View style={s.flex}>
                        <Text style={s.txTitle}>{t.title}</Text>
                        <Text style={s.small}>{t.sub}</Text>
                      </View>
                      <View style={s.txRight}>
                        <Text style={[s.txAmount, t.kind === "PAYOUT" && s.txOut]}>
                          {t.kind === "PAYOUT" ? `−${formatRupees(t.amount.replace("-", ""))}` : `+${formatRupees(t.amount)}`}
                        </Text>
                        <StatusChip label={STATE[t.state].label} tone={STATE[t.state].tone} />
                      </View>
                    </View>
                  ))}
                </View>
              )}

              <Text style={s.label}>PAYOUT ACCOUNT</Text>
              <Pressable onPress={() => router.push("/host/spot/payout")} accessibilityRole="button" style={s.card}>
                <Text style={s.txTitle}>
                  {account?.accountNumberLast4 ? `Bank account •• ${account.accountNumberLast4}` : "No payout account yet"}
                </Text>
                <Text style={s.small}>
                  {account?.payoutKycStatus === "ACTIVATED" ? "Verified" : "Not verified yet"}
                  {account?.accountHolderName ? ` · ${account.accountHolderName}` : ""} · Change
                </Text>
              </Pressable>
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
  hero: { backgroundColor: colors.ink, borderRadius: 16, padding: 18, gap: 4 },
  heroLabel: { fontSize: 13, color: colors.onInkMuted },
  heroValue: { fontSize: 32, fontWeight: "700", color: colors.onInk },
  heroSub: { fontSize: 13, color: colors.onInkMuted },
  pair: { flexDirection: "row", gap: 10 },
  tile: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 14, gap: 2 },
  tileValue: { fontSize: 20, fontWeight: "700", color: colors.ink },
  muted: { fontSize: 13, color: colors.inkMuted },
  small: { fontSize: 12, color: colors.inkMuted },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.lg, gap: 2 },
  label: { fontSize: 12, fontWeight: "700", letterSpacing: 1.2, color: colors.inkMuted },
  split: { backgroundColor: colors.canvas, borderRadius: radius.md, padding: space.lg, gap: 2 },
  splitTitle: { fontSize: 14, fontWeight: "700", color: colors.ink, marginBottom: 4 },
  list: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.lg },
  tx: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  flex: { flex: 1, gap: 2 },
  txTitle: { fontSize: 14, fontWeight: "600", color: colors.ink },
  txRight: { alignItems: "flex-end", gap: 4 },
  txAmount: { fontSize: 14, fontWeight: "700", color: "#166534" },
  txOut: { color: colors.ink },
});
