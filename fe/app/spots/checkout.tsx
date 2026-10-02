import { Redirect, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, authApi, bookingsApi, paymentsApi, spotsApi } from "@/api";
import {
  BikeIcon,
  Button,
  CardIcon,
  CarIcon,
  DataRow,
  ErrorNotice,
  Field,
  PhoneFrame,
  PlusIcon,
  RestoringScreen,
  ScreenHeader,
  SpotCover,
  WalletIcon,
} from "@/components/ui";
import type { VehicleType } from "@/constants/enums";
import { useNow } from "@/features/bookings/useNow";
import { LegalText } from "@/features/legal/LegalText";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { keyFor, type Attempt } from "@/lib/idempotency";
import { formatRupees } from "@/lib/money";
import {
  openPaymentPage,
  payPlatform,
  startCardPayment,
  UPI_APP_LABELS,
  upiAppsFor,
  type PaymentMethod,
} from "@/lib/payments";
import { UserError } from "@/lib/userError";
import { describeRange, formatDuration, hasStarted, MIN_STAY_MINUTES, STARTED_MESSAGE } from "@/lib/searchCriteria";
import { searchVehicle } from "@/lib/searchVehicle";
import { spaceLabel, VEHICLE_LABELS } from "@/lib/spotLabels";
import { loadVehicles } from "@/lib/vehicleCache";
import { useScreenInsets } from "@/hooks/useScreenInsets";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space } from "@/theme";
import type { HeldSpotBooking, PaymentOptions, PublicSpot, StayQuote, UpiApp, Vehicle } from "@/types/api.types";

const METHODS: { key: PaymentMethod; title: string; sub: string }[] = [
  { key: "UPI", title: "UPI", sub: "Google Pay, PhonePe, Paytm or any UPI app" },
  // Offered only when the API says so: its sandbox, for now (owner's call).
  { key: "CARD", title: "Credit / debit card", sub: "Test mode: Cashfree's test cards only" },
];

const PLATFORM = payPlatform();
const UPI_APPS = upiAppsFor(PLATFORM);

/** The card as typed, digits only where only digits belong. Held in memory, never stored. */
const EMPTY_CARD = { number: "", holder: "", expiry: "", cvv: "" };

function cardProblem(card: typeof EMPTY_CARD): string | null {
  if (!/^\d{12,19}$/.test(card.number)) return "Enter the card number.";
  if (!card.holder.trim()) return "Enter the name on the card.";
  const month = Number(card.expiry.slice(0, 2));
  if (!/^\d{4}$/.test(card.expiry) || month < 1 || month > 12) return "Enter the expiry as MM/YY.";
  if (!/^\d{3,4}$/.test(card.cvv)) return "Enter the CVV.";
  return null;
}

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
  const { token, isRestoring, user, setUser } = useSession();
  const params = useLocalSearchParams<{ id: string; from: string; to: string; vehicle?: string }>();
  const searched = Array.isArray(params.vehicle) ? params.vehicle[0] : params.vehicle;
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const range = readRange(params.from, params.to);
  // Re-read while the screen is open: a driver can sit here past the start.
  const now = useNow(30_000);
  const started = !!range && hasStarted(range.from, now);

  const [spot, setSpot] = useState<PublicSpot | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("UPI");
  const [quote, setQuote] = useState<StayQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [held, setHeld] = useState<HeldSpotBooking | null>(null);
  const [outcome, setOutcome] = useState<"NOT_CONFIGURED" | null>(null);
  const [options, setOptions] = useState<PaymentOptions | null>(null);
  const [upiApp, setUpiApp] = useState<UpiApp | undefined>(UPI_APPS[0]);
  const [card, setCard] = useState(EMPTY_CARD);
  const [phone, setPhone] = useState("");
  const attempt = useRef<Attempt | null>(null);
  /** What this visit has already read and needn't read again. */
  const loaded = useRef<{ id: string; spot: PublicSpot; options: PaymentOptions } | null>(null);

  /**
   * The spot and the driver's vehicles, on every focus -- not once on mount.
   * "Add a vehicle" opens the vehicles screen on top of this one and comes
   * back without remounting it, so a list read only at mount would still be
   * the one from before the vehicle was added.
   *
   * The choice survives a reload while that vehicle can still park here;
   * otherwise it starts on the vehicle the driver searched with (carried in
   * the params from the search form), then the default that fits, then any
   * that fits -- which is also how a first vehicle, just added, is selected.
   *
   * Only the vehicles can have changed while this screen sat underneath
   * another, so the spot and the payment options are read once per visit and
   * kept; the price itself always comes fresh from the quote below.
   */
  const load = useCallback(async () => {
    if (!token || !id) return;
    try {
      const kept = loaded.current?.id === id ? loaded.current : null;
      const [found, saved, payment] = await Promise.all([
        kept?.spot ?? spotsApi.getById(token, id),
        loadVehicles(token),
        kept?.options ?? paymentsApi.options(token),
      ]);
      loaded.current = { id, spot: found, options: payment };
      setSpot(found);
      setVehicles(saved);
      setOptions(payment);
      // A method the API stopped offering (card outside the sandbox) falls back to UPI.
      setMethod((current) => (payment.methods.includes(current) ? current : "UPI"));
      setLoadError(null);
      const takes = (v: Vehicle) => found.pricing.some((p) => p.vehicleType === v.vehicleType);
      setVehicleId((current) => {
        const kept = saved.find((v) => v.id === current && takes(v));
        const fromSearch = searchVehicle(saved, searched);
        return (
          kept ??
          (fromSearch && takes(fromSearch) ? fromSearch : undefined) ??
          saved.find((v) => v.isDefault && takes(v)) ??
          saved.find(takes) ??
          saved[0]
        )?.id ?? null;
      });
    } catch (err) {
      setLoadError(err instanceof ApiError && err.status === 404 ? "This spot is no longer available." : "Could not load this spot.");
    }
  }, [token, id, searched]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const vehicle = vehicles?.find((v) => v.id === vehicleId) ?? null;
  const takesVehicle = !!(vehicle && spot?.pricing.some((p) => p.vehicleType === vehicle.vehicleType));

  useEffect(() => {
    setQuoteError(null);
    // A started stay isn't priced -- unless it is already held, and so payable.
    if (!token || !id || !range || !vehicle || !takesVehicle || (started && !held)) {
      setQuote(null);
      return;
    }
    spotsApi
      .quote(token, id, { vehicleType: vehicle.vehicleType as VehicleType, startsAt: range.from.toISOString(), endsAt: range.to.toISOString() })
      .then(setQuote)
      .catch((err) => {
        // Said, not swallowed: a blank total with a disabled button and no
        // reason reads as the app being broken.
        setQuote(null);
        setQuoteError(err instanceof ApiError ? err.message : "Could not work out the price. Try again.");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id, vehicle?.id, takesVehicle, params.from, params.to, started, !!held]);

  // The gateway needs a mobile number with every order: asked here, once,
  // and saved to the profile (the API refuses a hold without one).
  const needsPhone = !!options?.enabled && !user?.phone;
  const phoneOk = !needsPhone || /^[6-9]\d{9}$/.test(phone);
  const cardError = method === "CARD" ? cardProblem(card) : null;

  const { run: reserve, busy, error } = useAsyncAction(async () => {
    if (!token || !id || !vehicle || !range) return;
    setOutcome(null);
    // A hold already placed can still be paid; a new one can't start in the past.
    if (started && !held) throw new UserError(STARTED_MESSAGE);
    if (!phoneOk) throw new UserError("Enter a 10-digit mobile number, starting 6–9.");
    if (cardError) throw new UserError(cardError);

    if (needsPhone) setUser(await authApi.updateProfile(token, { phone }));

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

    if (!options?.enabled) {
      setOutcome("NOT_CONFIGURED");
      return;
    }

    if (method === "CARD") {
      if (!booking.checkout || !options.apiVersion) throw new UserError("Couldn't start the card payment. Try again.");
      const page = await startCardPayment(booking.checkout, options.apiVersion, {
        number: card.number,
        holder: card.holder.trim(),
        expiryMonth: card.expiry.slice(0, 2),
        expiryYear: card.expiry.slice(2, 4),
        cvv: card.cvv,
      });
      // The CVV isn't kept a moment longer than the call that needed it.
      setCard((current) => ({ ...current, cvv: "" }));
      await openPaymentPage(page, booking.id);
      // On the web the page has navigated away; the gateway brings the driver
      // back to the pay screen. In the app the page was a sheet, now closed.
      if (Platform.OS !== "web") router.replace({ pathname: "/booking/[id]/pay", params: { id: booking.id } });
      return;
    }

    // Replace, not push: once the hold exists, checkout is done. Coming back
    // to it would show the driver's own hold as "just booked" by someone.
    router.replace({ pathname: "/booking/[id]/pay", params: { id: booking.id, method: "UPI", ...(upiApp ? { app: upiApp } : {}) } });
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

              <Card title="WHEN" action={{ label: "Change", onPress: started ? () => router.replace("/home") : back }}>
                <Text style={s.big}>{describeRange(range.from, range.to)}</Text>
                <Text style={s.muted}>{formatDuration(range.minutes)}</Text>
                {started && !held ? <Text style={s.warn}>{STARTED_MESSAGE}</Text> : null}
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
                          {v.vehicleType === "BIKE" ? <BikeIcon size={19} /> : <CarIcon size={19} />}
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

              {quoteError ? <ErrorNotice message={quoteError} /> : null}

              {quote ? (
                <Card title="PRICE">
                  {quote.available ? (
                    <>
                      <DataRow label={quote.basis === "DAILY" ? "Parking (day rate)" : "Parking"} value={formatRupees(quote.parking)} />
                      {/* No driver-side fee: GatePass's service fee comes out of the host's
                          share. Shown only if a quote ever carries one again. */}
                      {Number(quote.platformFee) > 0 ? <DataRow label="Fee" value={formatRupees(quote.platformFee)} /> : null}
                      {Number(quote.taxAmount) > 0 ? <DataRow label="GST" value={formatRupees(quote.taxAmount)} /> : null}
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
                {METHODS.filter((m) => m.key === "UPI" || options?.methods.includes(m.key)).map((m) => {
                  const on = m.key === method;
                  return (
                    <View key={m.key} style={[s.method, on && s.optionOn]}>
                      <Pressable
                        onPress={() => setMethod(m.key)}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: on }}
                        style={s.methodHead}
                      >
                        <View style={s.optionIcon}>{m.key === "CARD" ? <CardIcon /> : <WalletIcon size={19} />}</View>
                        <View style={s.flex}>
                          <Text style={s.optionTitle}>{m.title}</Text>
                          <Text style={s.muted}>
                            {m.key === "UPI" && PLATFORM === "desktop" ? "Scan a QR code with any UPI app on your phone" : m.sub}
                          </Text>
                        </View>
                        <Radio on={on} />
                      </Pressable>

                      {on && m.key === "UPI" && UPI_APPS.length > 0 ? (
                        <View style={s.chips}>
                          {UPI_APPS.map((app) => (
                            <Pressable
                              key={app}
                              onPress={() => setUpiApp(app)}
                              accessibilityRole="radio"
                              accessibilityState={{ checked: app === upiApp }}
                              style={[s.chip, app === upiApp && s.chipOn]}
                            >
                              <Text style={[s.chipText, app === upiApp && s.chipTextOn]}>{UPI_APP_LABELS[app]}</Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : null}

                      {on && m.key === "CARD" ? (
                        <View style={s.cardForm}>
                          <Field
                            label="Card number"
                            value={card.number}
                            onChangeText={(t) => setCard((c) => ({ ...c, number: t.replace(/\D/g, "").slice(0, 19) }))}
                            keyboardType="number-pad"
                            autoComplete="cc-number"
                            placeholder="4706 1312 1121 2123"
                          />
                          <Field
                            label="Name on card"
                            value={card.holder}
                            onChangeText={(t) => setCard((c) => ({ ...c, holder: t.slice(0, 60) }))}
                            autoComplete="cc-name"
                            autoCapitalize="characters"
                          />
                          <View style={s.cardRow}>
                            <View style={s.flex}>
                              <Field
                                label="Expiry (MM/YY)"
                                value={card.expiry.length > 2 ? `${card.expiry.slice(0, 2)}/${card.expiry.slice(2)}` : card.expiry}
                                onChangeText={(t) => setCard((c) => ({ ...c, expiry: t.replace(/\D/g, "").slice(0, 4) }))}
                                keyboardType="number-pad"
                                placeholder="03/28"
                              />
                            </View>
                            <View style={s.flex}>
                              <Field
                                label="CVV"
                                value={card.cvv}
                                onChangeText={(t) => setCard((c) => ({ ...c, cvv: t.replace(/\D/g, "").slice(0, 4) }))}
                                keyboardType="number-pad"
                                secureTextEntry
                                autoComplete="cc-csc"
                              />
                            </View>
                          </View>
                          <Text style={s.note}>
                            Test mode. Use a Cashfree test card (e.g. 4706 1312 1121 2123, 03/28, CVV 123, OTP 111000).
                            No real money moves.
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>

              {needsPhone ? (
                <Field
                  label="Mobile number"
                  hint="Our payment partner needs it for every payment. Saved to your profile."
                  value={phone}
                  onChangeText={(t) => setPhone(t.replace(/\D/g, "").slice(0, 10))}
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  error={phone.length === 10 && !phoneOk ? "A 10-digit Indian mobile number, starting 6-9." : null}
                />
              ) : null}

              <View style={s.policy}>
                <Text style={s.policyTitle}>Cancellation</Text>
                <LegalText
                  text="Free until an hour before your parking starts; after that, half the parking back until it starts. [Cancellation & Refund Policy](/refund)"
                  style={s.policyText}
                />
              </View>

              <LegalText
                text="By paying, you agree to our [Terms & Conditions](/terms). Payments are handled by our payment partner, Cashfree Payments. GatePass never sees your UPI PIN or full card number."
                style={s.fine}
              />

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
              {/* Why there is no total yet: the price depends on the vehicle. */}
              {!quote?.available ? (
                <Text style={s.barHint}>
                  {started && !held
                    ? "This time has passed. Change the time"
                    : vehicles?.length === 0
                    ? "Add a vehicle to see the total"
                    : !vehicle || !takesVehicle
                      ? "Pick a vehicle this space takes"
                      : quote && !quote.available
                        ? "Not available for these hours"
                        : quoteError
                          ? "Couldn't price this stay"
                          : "Working out the price…"}
                </Text>
              ) : null}
            </View>
            <View style={s.barCta}>
              <Button
                label={held ? "Pay" : "Pay & Reserve"}
                size="lg"
                onPress={reserve}
                busy={busy}
                disabled={(!held && !quote?.available) || !vehicle || outcome === "NOT_CONFIGURED" || !phoneOk || !!cardError}
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
  warn: { fontSize: 13, color: colors.dangerInk },
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
  method: { borderWidth: 1, borderColor: colors.border, borderRadius: 10 },
  methodHead: {
    minHeight: 60,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, paddingHorizontal: 14, paddingBottom: 14 },
  chip: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: colors.border, justifyContent: "center" },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.ink },
  chipTextOn: { color: colors.surface },
  cardForm: { gap: space.md, paddingHorizontal: 14, paddingBottom: 14 },
  cardRow: { flexDirection: "row", gap: space.md },
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
  barHint: { fontSize: 11, color: colors.inkMuted, marginTop: 2 },
  barCta: { flex: 1.4 },
});
