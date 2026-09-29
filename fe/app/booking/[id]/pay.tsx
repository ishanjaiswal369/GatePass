import { Redirect, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, BackHandler, Image, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, bookingsApi, paymentsApi } from "@/api";
import {
  Button,
  CalendarIcon,
  CarIcon,
  ErrorNotice,
  LockIcon,
  PhoneFrame,
  RestoringScreen,
  ScreenHeader,
  UpiAppLogo,
} from "@/components/ui";
import { useNow } from "@/features/bookings/useNow";
import { HoldTimer } from "@/features/payments/HoldTimer";
import { PaymentWaiting } from "@/features/payments/PaymentWaiting";
import { UpiAppTiles } from "@/features/payments/UpiAppTiles";
import { bookingListing, bookingWhen } from "@/lib/booking";
import { formatRupees } from "@/lib/money";
import {
  clientHints,
  openUpiApp,
  payPlatform,
  UPI_APP_LABELS,
  upiAppsFor,
  upiChannelFor,
} from "@/lib/payments";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space } from "@/theme";
import type { BookingDetail, UpiApp, UpiPaymentStart } from "@/types/api.types";

const POLL_MS = 4000;

/** Why a paid booking was refunded instead of confirmed (the API's refund policy). */
const LATE_REFUND_REASONS: Record<string, string> = {
  HOLD_LAPSED: "The hold had ended before the payment came through, and the space was booked by someone else.",
  CANCELLED_BEFORE_PAYMENT: "The booking was cancelled before the payment came through.",
  PAID_AFTER_STAY: "The payment came through after the stay had already ended.",
};

/**
 * Paying for a held booking, and waiting for the answer.
 *
 * With `method=UPI` it starts a UPI attempt: on a phone it opens the chosen
 * app (by itself in the app; on a tap in a browser, which blocks unprompted
 * opens), on a desktop it shows a QR. With no method -- back from the card
 * page -- it only waits.
 *
 * Either way the answer comes from the API: the booking is read every few
 * seconds and when the app comes back to the front, and only a booking the
 * API calls confirmed goes on to the confirmation screen. Nothing the UPI app
 * or the card page says counts.
 */
export default function PayScreen() {
  const { token, isRestoring } = useSession();
  const params = useLocalSearchParams<{ id: string; method?: string; app?: string; channel?: string; from?: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  // Every second: this is a countdown the driver is watching.
  const now = useNow(1000);

  const platform = payPlatform();
  const offered = upiAppsFor(platform);
  const wantedApp = (offered as string[]).includes(params.app ?? "") ? (params.app as UpiApp) : offered[0];
  const isUpi = params.method === "UPI";

  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<UpiPaymentStart | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [appNote, setAppNote] = useState<string | null>(null);
  const [lastOpened, setLastOpened] = useState<UpiApp | null>(null);
  const started = useRef(false);

  const done = !!booking && booking.phase !== "PENDING";

  // Back goes to the booking -- the hold, with its countdown, Pay and Cancel
  // -- never to the checkout that made it: that screen would read the
  // driver's own hold as hours someone else just booked.
  const back = useCallback(() => {
    if (params.from === "booking" && router.canGoBack()) router.back();
    else if (id) router.replace({ pathname: "/booking/[id]", params: { id } });
  }, [params.from, id]);

  // Android's hardware back takes the same way, not the stack's.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        back();
        return true;
      });
      return () => sub.remove();
    }, [back])
  );

  const load = useCallback(async () => {
    if (!token || !id) return;
    try {
      const found = await bookingsApi.get(token, id);
      setBooking(found);
      setLoadError(null);
      if (found.status === "CONFIRMED") {
        router.replace({ pathname: "/booking/[id]/confirmed", params: { id: found.id } });
      }
    } catch (err) {
      setLoadError(err instanceof ApiError && err.status === 404 ? "This booking doesn't exist, or isn't yours." : "Couldn't check the booking.");
    }
  }, [token, id]);

  // Poll while this screen is in front and the booking is still waiting.
  useFocusEffect(
    useCallback(() => {
      if (done) return;
      void load();
      const timer = setInterval(() => void load(), POLL_MS);
      // Back from the UPI app: check at once rather than on the next tick.
      const sub = AppState.addEventListener("change", (state) => {
        if (state === "active") void load();
      });
      return () => {
        clearInterval(timer);
        sub.remove();
      };
    }, [load, done])
  );

  const open = useCallback(
    async (app: UpiApp, links: Partial<Record<UpiApp, string>>) => {
      const link = links[app];
      if (!link) {
        setAppNote(`${UPI_APP_LABELS[app]} isn't available for this payment. Pick another app.`);
        return;
      }
      const opened = await openUpiApp(link);
      if (opened) setLastOpened(app);
      setAppNote(opened ? null : `Couldn't open ${UPI_APP_LABELS[app]}. Is it installed? Pick another app.`);
    },
    []
  );

  const start = useCallback(
    async (channel: "INTENT" | "QR", autoOpen: boolean) => {
      if (!token || !id) return;
      setStarting(true);
      setStartError(null);
      setAppNote(null);
      try {
        const next = await paymentsApi.startUpi(token, id, { channel, client: clientHints() });
        setAttempt(next);
        if (next.channel === "INTENT" && autoOpen && wantedApp) await open(wantedApp, next.apps);
      } catch (err) {
        setStartError(err instanceof ApiError ? err.message : "Couldn't start the payment. Try again.");
      } finally {
        setStarting(false);
      }
    },
    [token, id, wantedApp, open]
  );

  // The first UPI attempt, once. In the app it opens the chosen UPI app
  // straight away; a browser only opens one from a tap.
  useEffect(() => {
    if (!isUpi || started.current || !token || !id) return;
    started.current = true;
    const channel = params.channel === "QR" ? "QR" : upiChannelFor(platform);
    void start(channel, Platform.OS !== "web");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUpi, token, id]);

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;
  if (!id) return <Redirect href="/bookings" />;

  const listing = booking ? bookingListing(booking) : null;
  const total = booking ? Number(booking.amount) + Number(booking.platformFee) + Number(booking.taxAmount) : null;
  const left = booking?.holdExpiresAt ? Math.max(0, Date.parse(booking.holdExpiresAt) - now) : null;
  const expired = booking?.phase === "EXPIRED" || left === 0;

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader title={isUpi ? "Pay with UPI" : "Confirming payment"} sub={listing?.name ?? undefined} onBack={back} />

        <ScrollView contentContainerStyle={s.body}>
          {loadError ? <ErrorNotice message={loadError} /> : null}

          {booking && total !== null ? (
            <View style={s.summary}>
              <View style={s.summaryTop}>
                <View style={s.flex}>
                  <Text style={s.muted}>Amount to pay</Text>
                  <Text style={s.amount}>{formatRupees(total.toFixed(2))}</Text>
                </View>
                {left !== null && booking.phase === "PENDING" ? <HoldTimer msLeft={left} /> : null}
              </View>
              <View style={s.rule} />
              {bookingWhen(booking) ? (
                <View style={s.fact}>
                  <CalendarIcon size={15} color={colors.inkMuted} />
                  <Text style={s.factText}>{bookingWhen(booking)}</Text>
                </View>
              ) : null}
              <View style={s.fact}>
                <CarIcon size={15} color={colors.inkMuted} />
                <Text style={s.factText}>{booking.vehicleNumber}</Text>
              </View>
            </View>
          ) : !loadError ? (
            <ActivityIndicator color={colors.ink} style={s.loading} />
          ) : null}

          {booking?.refund ? (
            // Paid, but the booking couldn't stand: the hold had lapsed and the
            // hours were taken, or it was cancelled first. The API refunds all of it.
            <View style={s.ended}>
              <Text style={s.endedTitle}>
                {booking.refund.policy === "HOLD_LAPSED" ? "Your payment came too late for these hours" : "This booking is being refunded"}
              </Text>
              <Text style={s.endedBody}>
                {LATE_REFUND_REASONS[booking.refund.policy] ?? "This booking couldn't go ahead."} We're refunding the full{" "}
                {formatRupees(booking.refund.amount)}. It usually reaches you in 5–7 working days.
              </Text>
              <Button label="Find another space" variant="ghost" onPress={() => router.replace("/home")} />
            </View>
          ) : expired ? (
            <View style={s.ended}>
              <Text style={s.endedTitle}>The hold has ended</Text>
              <Text style={s.endedBody}>
                These hours went back on sale before a payment came through. If money left your account it comes back
                automatically within 5–7 working days.
              </Text>
              <Button label="Back to search" variant="ghost" onPress={() => router.replace("/home")} />
            </View>
          ) : booking?.phase === "CANCELLED" ? (
            <View style={s.ended}>
              <Text style={s.endedTitle}>This booking was cancelled</Text>
            </View>
          ) : (
            <>
              {!isUpi || attempt ? (
                <PaymentWaiting
                  title={isUpi ? "Waiting for your payment" : "Confirming your payment"}
                  body={
                    attempt?.channel === "QR"
                      ? "Scan the code and approve the payment. This screen updates by itself; nothing is booked until then."
                      : isUpi
                        ? "Approve the payment in your UPI app, then come back. This screen updates by itself; nothing is booked until then."
                        : "This updates by itself once our payment partner confirms it; nothing is booked until then."
                  }
                />
              ) : null}

              {startError ? <ErrorNotice message={startError} /> : null}

              {isUpi && starting && !attempt ? <ActivityIndicator color={colors.ink} style={s.loading} /> : null}

              {attempt?.channel === "QR" ? (
                <View style={s.qrCard}>
                  <View style={s.qrFrame}>
                    <Image source={{ uri: attempt.qrImage }} style={s.qr} accessibilityLabel="UPI QR code for this payment" />
                  </View>
                  <Text style={s.qrTitle}>Scan to pay {total !== null ? formatRupees(total.toFixed(2)) : ""}</Text>
                  <Text style={s.qrSub}>Open any UPI app on your phone and scan this code.</Text>
                  <View style={s.worksWith}>
                    {(["gpay", "phonepe", "paytm", "bhim"] as const).map((app) => (
                      <UpiAppLogo key={app} app={app} size={32} />
                    ))}
                  </View>
                </View>
              ) : null}

              {attempt?.channel === "INTENT" ? (
                <View style={s.section}>
                  <Text style={s.label}>Pay with</Text>
                  <UpiAppTiles
                    apps={offered.filter((app) => attempt.apps[app])}
                    lastOpened={lastOpened}
                    onOpen={(app) => void open(app, attempt.apps)}
                    onShowQr={() => void start("QR", false)}
                  />
                  {appNote ? <ErrorNotice message={appNote} /> : null}
                </View>
              ) : null}

              <View style={s.trust}>
                <LockIcon size={13} color={colors.inkFaint} />
                <Text style={s.trustText}>Secured by Cashfree Payments. GatePass never sees your UPI PIN.</Text>
              </View>

              {booking?.phase === "PENDING" ? (
                <Button label="View booking" variant="ghost" onPress={back} />
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
  body: { padding: 20, gap: space.lg, paddingBottom: 32 },
  loading: { paddingVertical: space.xl },
  flex: { flex: 1, gap: 2 },
  muted: { fontSize: 13, color: colors.inkMuted },
  section: { gap: space.md },
  label: { fontSize: 13, fontWeight: "600", letterSpacing: 0.6, color: colors.inkMuted, textTransform: "uppercase" },

  summary: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.lg, gap: space.sm },
  summaryTop: { flexDirection: "row", alignItems: "center", gap: space.md },
  amount: { fontSize: 30, fontWeight: "700", color: colors.ink, letterSpacing: -0.5 },
  rule: { height: 1, backgroundColor: colors.border, marginVertical: space.xs },
  fact: { flexDirection: "row", alignItems: "center", gap: space.sm },
  factText: { fontSize: 13, color: colors.inkMuted },

  qrCard: { alignItems: "center", gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.xl },
  qrFrame: { padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: space.sm },
  qr: { width: 200, height: 200 },
  qrTitle: { fontSize: 17, fontWeight: "700", color: colors.ink },
  qrSub: { fontSize: 13, color: colors.inkMuted, textAlign: "center" },
  worksWith: { flexDirection: "row", gap: space.sm, marginTop: space.md },

  trust: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  trustText: { flexShrink: 1, fontSize: 12, lineHeight: 17, color: colors.inkFaint, textAlign: "center" },

  ended: { backgroundColor: colors.dangerSurface, borderRadius: radius.md, padding: 14, gap: 8 },
  endedTitle: { fontSize: 15, fontWeight: "700", color: colors.dangerInk },
  endedBody: { fontSize: 13, lineHeight: 19, color: colors.dangerInk },
});
