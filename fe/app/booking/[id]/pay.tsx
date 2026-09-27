import { Redirect, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, BackHandler, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, bookingsApi, paymentsApi } from "@/api";
import { Button, ErrorNotice, PhoneFrame, RestoringScreen, ScreenHeader, WalletIcon } from "@/components/ui";
import { useNow } from "@/features/bookings/useNow";
import { bookingListing } from "@/lib/booking";
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
            <View style={s.amountRow}>
              <View style={s.flex}>
                <Text style={s.muted}>To pay</Text>
                <Text style={s.amount}>{formatRupees(total.toFixed(2))}</Text>
              </View>
              {left !== null && booking.phase === "PENDING" ? (
                <View style={s.timer}>
                  <Text style={s.timerLabel}>Held for</Text>
                  <Text style={s.timerValue}>{clock(left)}</Text>
                </View>
              ) : null}
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
              {startError ? <ErrorNotice message={startError} /> : null}

              {isUpi && starting && !attempt ? <ActivityIndicator color={colors.ink} style={s.loading} /> : null}

              {attempt?.channel === "QR" ? (
                <View style={s.qrCard}>
                  <Image source={{ uri: attempt.qrImage }} style={s.qr} accessibilityLabel="UPI QR code for this payment" />
                  <Text style={s.qrTitle}>Scan with any UPI app</Text>
                  <Text style={s.muted}>Google Pay, PhonePe, Paytm, BHIM or your bank's app.</Text>
                </View>
              ) : null}

              {attempt?.channel === "INTENT" ? (
                <View style={s.gap}>
                  <Text style={s.label}>OPEN YOUR UPI APP</Text>
                  {offered
                    .filter((app) => attempt.apps[app])
                    .map((app) => (
                      <Pressable
                        key={app}
                        onPress={() => void open(app, attempt.apps)}
                        accessibilityRole="button"
                        style={[s.appRow, app === wantedApp && s.appRowOn]}
                      >
                        <View style={s.appIcon}>
                          <WalletIcon size={19} />
                        </View>
                        <Text style={s.appTitle}>{UPI_APP_LABELS[app]}</Text>
                        <Text style={s.appOpen}>Open</Text>
                      </Pressable>
                    ))}
                  {appNote ? <Text style={s.warn}>{appNote}</Text> : null}
                  <Pressable onPress={() => void start("QR", false)} accessibilityRole="button" style={s.link}>
                    <Text style={s.linkText}>Paying from another phone? Show a QR code</Text>
                  </Pressable>
                </View>
              ) : null}

              {!isUpi || attempt ? (
                <View style={s.waiting}>
                  <ActivityIndicator color={colors.accentInk} />
                  <View style={s.flex}>
                    <Text style={s.waitingTitle}>Waiting for the payment to be confirmed</Text>
                    <Text style={s.waitingBody}>
                      This updates by itself once our payment partner confirms it. Keep this screen open or come back to
                      it; nothing is booked until then.
                    </Text>
                  </View>
                </View>
              ) : null}

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

function clock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  body: { padding: 20, gap: 18, paddingBottom: 32 },
  loading: { paddingVertical: space.xl },
  flex: { flex: 1, gap: 2 },
  gap: { gap: 10 },
  muted: { fontSize: 13, color: colors.inkMuted },
  warn: { fontSize: 13, color: "#b91c1c" },
  label: { fontSize: 12, fontWeight: "700", letterSpacing: 1.2, color: colors.inkMuted },
  amountRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  amount: { fontSize: 24, fontWeight: "700", color: colors.ink },
  timer: { alignItems: "flex-end", backgroundColor: colors.canvas, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 },
  timerLabel: { fontSize: 11, color: colors.inkMuted },
  timerValue: { fontSize: 18, fontWeight: "700", color: colors.ink, fontVariant: ["tabular-nums"] },
  qrCard: { alignItems: "center", gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.lg },
  qr: { width: 220, height: 220 },
  qrTitle: { fontSize: 16, fontWeight: "700", color: colors.ink, marginTop: 4 },
  appRow: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
  },
  appRowOn: { borderWidth: 2, borderColor: colors.ink },
  appIcon: { width: 36, height: 36, borderRadius: 8, backgroundColor: colors.canvas, alignItems: "center", justifyContent: "center" },
  appTitle: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.ink },
  appOpen: { fontSize: 14, fontWeight: "700", color: colors.ink, textDecorationLine: "underline" },
  link: { minHeight: 40, justifyContent: "center" },
  linkText: { fontSize: 14, fontWeight: "600", color: colors.ink, textDecorationLine: "underline" },
  waiting: { flexDirection: "row", gap: space.md, alignItems: "flex-start", backgroundColor: colors.accentSurface, borderRadius: radius.md, padding: 14 },
  waitingTitle: { fontSize: 14, fontWeight: "700", color: colors.accentInk },
  waitingBody: { fontSize: 13, lineHeight: 19, color: colors.accentInk },
  ended: { backgroundColor: colors.dangerSurface, borderRadius: radius.md, padding: 14, gap: 8 },
  endedTitle: { fontSize: 15, fontWeight: "700", color: "#b91c1c" },
  endedBody: { fontSize: 13, lineHeight: 19, color: "#b91c1c" },
});
