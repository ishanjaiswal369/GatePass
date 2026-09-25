import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, bookingsApi, profileApi, spotsApi } from "@/api";
import {
  Button,
  CarIcon,
  DataRow,
  ErrorNotice,
  PhoneFrame,
  PlusIcon,
  RestoringScreen,
  ScreenHeader,
  SpotCover,
  WalletIcon,
} from "@/components/ui";
import type { VehicleType } from "@/constants/enums";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { keyFor, type Attempt } from "@/lib/idempotency";
import { formatRupees } from "@/lib/money";
import { payForBooking, type PaymentMethod } from "@/lib/payments";
import { describeRange, formatDuration, MIN_STAY_MINUTES } from "@/lib/searchCriteria";
import { spaceLabel, VEHICLE_LABELS } from "@/lib/spotLabels";
import { useScreenInsets } from "@/hooks/useScreenInsets";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space } from "@/theme";
import type { BookingRow, PublicSpot, StayQuote, Vehicle } from "@/types/api.types";

const METHODS: { key: PaymentMethod; title: string; sub: string }[] = [
  { key: "UPI", title: "UPI", sub: "Google Pay, PhonePe, Paytm or any UPI app" },
  { key: "CARD", title: "Credit / debit card", sub: "Visa, Mastercard, RuPay" },
  { key: "NETBANKING", title: "Netbanking", sub: "Choose your bank on the next step" },
];

/**
 * Reviewing a stay and paying for it.
 *
 * Every number comes from the server's quote -- the same function the
 * booking charges with -- so what is shown is what is taken. Paying first
 * holds the space (the overlap guard keeps it for 15 minutes), then hands
 * over to the payment seam. The booking is confirmed by the gateway's
 * notification to the API, never by this screen.
 */
export default function CheckoutScreen() {
  const insets = useScreenInsets();
  const { token, isRestoring } = useSession();
  const params = useLocalSearchParams<{ id: string; from: string; to: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const range = readRange(params.from, params.to);

  const [spot, setSpot] = useState<PublicSpot | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("UPI");
  const [quote, setQuote] = useState<StayQuote | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [held, setHeld] = useState<BookingRow | null>(null);
  const [outcome, setOutcome] = useState<"FAILED" | "CANCELLED" | "NOT_CONFIGURED" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const attempt = useRef<Attempt | null>(null);

  const load = useCallback(async () => {
    if (!token || !id) return;
    try {
      const [found, { vehicles: saved }] = await Promise.all([spotsApi.getById(token, id), profileApi.listVehicles(token)]);
      setSpot(found);
      setVehicles(saved);
      const takes = (v: Vehicle) => found.pricing.some((p) => p.vehicleType === v.vehicleType);
      setVehicleId(
        (saved.find((v) => v.isDefault && takes(v)) ?? saved.find(takes) ?? saved[0])?.id ?? null
      );
    } catch (err) {
      setLoadError(err instanceof ApiError && err.status === 404 ? "This spot is no longer available." : "Could not load this spot.");
    }
  }, [token, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const vehicle = vehicles?.find((v) => v.id === vehicleId) ?? null;
  const takesVehicle = !!(vehicle && spot?.pricing.some((p) => p.vehicleType === vehicle.vehicleType));

  useEffect(() => {
    if (!token || !id || !range || !vehicle || !takesVehicle) {
      setQuote(null);
      return;
    }
    spotsApi
      .quote(token, id, { vehicleType: vehicle.vehicleType as VehicleType, startsAt: range.from.toISOString(), endsAt: range.to.toISOString() })
      .then(setQuote)
      .catch(() => setQuote(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id, vehicle?.id, takesVehicle, params.from, params.to]);

  const pay = async (booking: BookingRow) => {
    if (!token) return;
    const total = (Number(booking.amount) + Number(booking.platformFee) + Number(booking.taxAmount)).toFixed(2);
    const result = await payForBooking({ token, bookingId: booking.id, amount: total, method });

    if (result.status === "PAID") {
      router.replace({ pathname: "/booking/[id]/confirmed", params: { id: booking.id } });
      return;
    }
    setOutcome(result.status);
    setFailure(result.status === "FAILED" ? result.message : null);
  };

  const { run: reserve, busy, error } = useAsyncAction(async () => {
    if (!token || !id || !vehicle || !range) return;
    setOutcome(null);
    const startsAt = range.from.toISOString();
    const endsAt = range.to.toISOString();

    // The hold first, keyed on everything that decides what is booked: a
    // retry after a dropped response replays it, a changed vehicle doesn't.
    const booking =
      held ??
      (await bookingsApi.createSpotBooking(token, {
        listingId: id,
        vehicleType: vehicle.vehicleType as VehicleType,
        vehicleNumber: vehicle.vehicleNumber,
        startsAt,
        endsAt,
        idempotencyKey: keyFor(attempt, `${id}|${vehicle.id}|${startsAt}|${endsAt}`),
      }));
    setHeld(booking);
    await pay(booking);
  });

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;
  if (!id || !range) return <Redirect href="/home" />;

  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader title="Review & pay" onBack={back} />

        <ScrollView contentContainerStyle={s.body}>
          {loadError ? <ErrorNotice message={loadError} /> : null}

          {outcome === "FAILED" ? (
            <View style={s.failed}>
              <Text style={s.failedTitle}>Payment couldn't be completed.</Text>
              <Text style={s.failedBody}>
                {failure ? `${failure} ` : ""}Nothing was booked. If money left your account it comes back automatically
                within 5–7 working days. The space stays held for you for a few more minutes.
              </Text>
            </View>
          ) : null}

          {!spot || !vehicles ? (
            loadError ? null : <ActivityIndicator color={colors.ink} style={s.loading} />
          ) : (
            <>
              <View style={s.spotRow}>
                <SpotCover url={spot.photos[0]?.url} style={s.thumb} />
                <View style={s.flex}>
                  <Text style={s.spotName}>{spot.name}</Text>
                  <Text style={s.muted}>
                    {spaceLabel(spot.spaceType)} · {spot.city}
                  </Text>
                </View>
              </View>

              <Card title="WHEN" action={{ label: "Change", onPress: back }}>
                <Text style={s.big}>{describeRange(range.from, range.to)}</Text>
                <Text style={s.muted}>{formatDuration(range.minutes)}</Text>
              </Card>

              <View style={s.gap}>
                <Text style={s.label}>VEHICLE</Text>
                {vehicles.length === 0 ? (
                  <Text style={s.muted}>Add the vehicle you're bringing. Security checks the number at the gate.</Text>
                ) : (
                  vehicles.map((v) => {
                    const takes = spot.pricing.some((p) => p.vehicleType === v.vehicleType);
                    const on = v.id === vehicleId;
                    return (
                      <Pressable
                        key={v.id}
                        onPress={() => setVehicleId(v.id)}
                        disabled={!takes || held !== null}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: on, disabled: !takes }}
                        style={[s.option, on && s.optionOn, !takes && s.optionOff]}
                      >
                        <View style={s.optionIcon}>
                          <CarIcon size={19} />
                        </View>
                        <View style={s.flex}>
                          <Text style={s.optionTitle}>{v.vehicleNumber}</Text>
                          <Text style={takes ? s.muted : s.warn}>
                            {takes
                              ? `${VEHICLE_LABELS[v.vehicleType as VehicleType]}${v.isDefault ? " · default" : ""}`
                              : `This space doesn't take a ${VEHICLE_LABELS[v.vehicleType as VehicleType].toLowerCase()}`}
                          </Text>
                        </View>
                        <Radio on={on} />
                      </Pressable>
                    );
                  })
                )}
                <Pressable onPress={() => router.push("/account/vehicles")} accessibilityRole="link" style={s.add}>
                  <PlusIcon size={17} />
                  <Text style={s.addText}>Add a vehicle</Text>
                </Pressable>
              </View>

              {quote ? (
                <Card title="PRICE">
                  {quote.available ? (
                    <>
                      <DataRow label={quote.basis === "DAILY" ? "Parking (day rate)" : "Parking"} value={formatRupees(quote.parking)} />
                      <DataRow label="Platform fee" value={formatRupees(quote.platformFee)} />
                      <DataRow label="GST on platform fee" value={formatRupees(quote.taxAmount)} />
                      <View style={s.totalRow}>
                        <Text style={s.totalLabel}>Total</Text>
                        <Text style={s.total}>{formatRupees(quote.total)}</Text>
                      </View>
                      {quote.basis === "DAILY" && quote.hourlyAmount ? (
                        <Text style={s.note}>The day rate is cheaper than {formatRupees(quote.hourlyAmount)} by the hour.</Text>
                      ) : null}
                    </>
                  ) : (
                    <Text style={s.warn}>{quote.reason}</Text>
                  )}
                </Card>
              ) : null}

              <View style={s.gap}>
                <Text style={s.label}>PAY WITH</Text>
                {METHODS.map((m) => {
                  const on = m.key === method;
                  return (
                    <Pressable
                      key={m.key}
                      onPress={() => setMethod(m.key)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      style={[s.option, on && s.optionOn]}
                    >
                      <View style={s.optionIcon}>
                        <WalletIcon size={19} />
                      </View>
                      <View style={s.flex}>
                        <Text style={s.optionTitle}>{m.title}</Text>
                        <Text style={s.muted}>{m.sub}</Text>
                      </View>
                      <Radio on={on} />
                    </Pressable>
                  );
                })}
              </View>

              <View style={s.policy}>
                <Text style={s.policyTitle}>Cancellation</Text>
                <Text style={s.policyText}>
                  Free until an hour before your parking starts; after that, half the parking back until it starts.
                </Text>
              </View>

              <Text style={s.fine}>
                Payments are handled by our payment partner. GatePass never sees your UPI PIN or full card number.
              </Text>

              {error ? <ErrorNotice message={error} /> : null}

              {outcome === "NOT_CONFIGURED" && held ? (
                <View style={s.held}>
                  <Text style={s.heldTitle}>Your space is held for 15 minutes</Text>
                  <Text style={s.heldBody}>
                    Online payment isn't switched on in this version yet, so this booking can't be paid for here. It
                    isn't confirmed until it's paid.
                  </Text>
                  <Button
                    label="View booking"
                    variant="ghost"
                    onPress={() => router.replace({ pathname: "/booking/[id]", params: { id: held.id } })}
                  />
                </View>
              ) : null}
            </>
          )}
        </ScrollView>

        {spot ? (
          <View style={[s.bar, { paddingBottom: 18 + insets.bottom }]}>
            <View style={s.flex}>
              <Text style={s.muted}>Total</Text>
              <Text style={s.barPrice}>{quote?.available ? formatRupees(quote.total) : "—"}</Text>
            </View>
            <View style={s.barCta}>
              <Button
                label={outcome === "FAILED" ? "Try Again" : "Pay & Reserve"}
                size="lg"
                onPress={reserve}
                busy={busy}
                disabled={!quote?.available || !vehicle || outcome === "NOT_CONFIGURED"}
              />
            </View>
          </View>
        ) : null}
      </View>
    </PhoneFrame>
  );
}

function Card({
  title,
  action,
  children,
}: {
  title: string;
  action?: { label: string; onPress: () => void };
  children: React.ReactNode;
}) {
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <Text style={s.label}>{title}</Text>
        {action ? (
          <Pressable onPress={action.onPress} accessibilityRole="button" style={s.cardAction}>
            <Text style={s.cardActionText}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function Radio({ on }: { on: boolean }) {
  return <View style={[s.radio]}>{on ? <View style={s.radioDot} /> : null}</View>;
}

function readRange(
  from: string | string[] | undefined,
  to: string | string[] | undefined
): { from: Date; to: Date; minutes: number } | null {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const start = Date.parse(first(from) ?? "");
  const end = Date.parse(first(to) ?? "");
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const minutes = Math.round((end - start) / 60_000);
  if (minutes < MIN_STAY_MINUTES) return null;
  return { from: new Date(start), to: new Date(end), minutes };
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  body: { padding: 20, gap: 18, paddingBottom: 24 },
  loading: { paddingVertical: space.xxl },
  gap: { gap: 10 },
  flex: { flex: 1, gap: 2 },
  spotRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  thumb: { width: 64, height: 64, aspectRatio: undefined, borderRadius: 10 },
  spotName: { fontSize: 16, fontWeight: "700", color: colors.ink },
  muted: { fontSize: 13, color: colors.inkMuted },
  warn: { fontSize: 13, color: "#b91c1c" },
  big: { fontSize: 16, fontWeight: "700", color: colors.ink },
  label: { fontSize: 12, fontWeight: "700", letterSpacing: 1.2, color: colors.inkMuted },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.lg, gap: 4 },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  cardAction: { minHeight: 32, justifyContent: "center" },
  cardActionText: { fontSize: 14, fontWeight: "600", color: colors.ink, textDecorationLine: "underline" },
  option: {
    minHeight: 60,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
  },
  optionOn: { borderWidth: 2, borderColor: colors.ink },
  optionOff: { opacity: 0.6 },
  optionIcon: { width: 36, height: 36, borderRadius: 8, backgroundColor: colors.canvas, alignItems: "center", justifyContent: "center" },
  optionTitle: { fontSize: 15, fontWeight: "600", color: colors.ink },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.ink, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.ink },
  add: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 44 },
  addText: { fontSize: 14, fontWeight: "600", color: colors.ink },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingTop: space.md },
  totalLabel: { fontSize: 16, fontWeight: "700", color: colors.ink },
  total: { fontSize: 18, fontWeight: "700", color: colors.ink },
  note: { fontSize: 12, color: colors.inkMuted, paddingTop: 4 },
  policy: { backgroundColor: colors.canvas, borderRadius: radius.md, padding: 14, gap: 4 },
  policyTitle: { fontSize: 14, fontWeight: "700", color: colors.ink },
  policyText: { fontSize: 13, lineHeight: 19, color: colors.inkMuted },
  fine: { fontSize: 12, lineHeight: 18, color: colors.inkMuted },
  failed: { backgroundColor: colors.dangerSurface, borderRadius: radius.md, padding: 14, gap: 4 },
  failedTitle: { fontSize: 15, fontWeight: "700", color: "#b91c1c" },
  failedBody: { fontSize: 13, lineHeight: 19, color: "#b91c1c" },
  held: { backgroundColor: colors.accentSurface, borderRadius: radius.md, padding: 14, gap: 6 },
  heldTitle: { fontSize: 15, fontWeight: "700", color: colors.accentInk },
  heldBody: { fontSize: 13, lineHeight: 19, color: colors.accentInk },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.lg,
    paddingHorizontal: 20,
    paddingTop: space.md,
    paddingBottom: 18,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  barPrice: { fontSize: 20, fontWeight: "700", color: colors.ink },
  barCta: { flex: 1.4 },
});
