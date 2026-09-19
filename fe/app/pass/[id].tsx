import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { ApiError, bookingsApi } from "@/api";
import {
  ChevronLeftIcon,
  ErrorNotice,
  PhoneFrame,
  RestoringScreen,
} from "@/components/ui";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space } from "@/theme";
import type { GatePassResult } from "@/types/api.types";

/** Refreshed a little before it expires, so the gate never sees a dead code. */
const REFRESH_MARGIN_SECONDS = 20;

export default function PassScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, isRestoring } = useSession();
  const [result, setResult] = useState<GatePassResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !id) return null;

    try {
      const next = await bookingsApi.getPass(token, id);
      setResult(next);
      setError(null);
      return next;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load pass");
      return null;
    }
  }, [token, id]);

  /**
   * The pass is deliberately short-lived, so this screen re-mints it on a
   * timer rather than showing a code that quietly stops working while the
   * driver is standing at the barrier.
   */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const cycle = async () => {
      const next = await load();
      if (cancelled || !next) return;

      const delay = Math.max(
        (next.pass.expiresInSeconds - REFRESH_MARGIN_SECONDS) * 1000,
        10_000
      );
      timer = setTimeout(cycle, delay);
    };

    void cycle();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  if (isRestoring) {
    return <RestoringScreen />;
  }

  if (!token) {
    return <Redirect href="/" />;
  }

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={s.back}
        >
          <ChevronLeftIcon color={colors.onInk} />
        </Pressable>

        {error ? (
          <View style={s.errorWrap}>
            <ErrorNotice message={error} />
          </View>
        ) : !result ? (
          <ActivityIndicator color={colors.onInk} />
        ) : (
          <>
            <View style={s.heading}>
              <Text style={s.event}>{result.booking.eventName}</Text>
              <Text style={s.venue}>{result.booking.venueName}</Text>
            </View>

            <View style={s.code}>
              <QRCode value={result.pass.token} size={220} />
            </View>

            <View style={s.facts}>
              {result.booking.gate ? (
                <View style={s.fact}>
                  <Text style={s.factLabel}>GATE</Text>
                  <Text style={s.factValue}>{result.booking.gate}</Text>
                </View>
              ) : null}
              <View style={s.fact}>
                <Text style={s.factLabel}>VEHICLE</Text>
                <Text style={s.factValue}>{result.booking.vehicleType}</Text>
              </View>
            </View>

            <Text style={s.note}>
              This code refreshes every few minutes. A screenshot will not scan.
            </Text>
          </>
        )}
      </View>
    </PhoneFrame>
  );
}

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
    gap: space.xl,
    padding: 28,
  },
  back: { position: "absolute", top: 44, left: 20, width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  errorWrap: { alignSelf: "stretch" },
  heading: { alignItems: "center", gap: 6 },
  event: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.onInk,
    textAlign: "center",
    letterSpacing: -0.4,
  },
  venue: { fontSize: 14, color: colors.onInkMuted, textAlign: "center" },
  code: { padding: space.lg, backgroundColor: colors.surface, borderRadius: radius.md },
  facts: { flexDirection: "row", gap: space.xxl },
  fact: { alignItems: "center", gap: 4 },
  factLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: colors.onInkMuted,
  },
  factValue: { fontSize: 16, fontWeight: "600", color: colors.onInk },
  note: {
    fontSize: 12,
    color: colors.onInkMuted,
    textAlign: "center",
    lineHeight: 18,
  },
});
