import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, bookingsApi } from "@/api";
import {
  Button,
  DataRow,
  ErrorNotice,
  LockIcon,
  PhoneFrame,
  RestoringScreen,
  ScreenHeader,
} from "@/components/ui";
import { useNow } from "@/features/bookings/useNow";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { clockTime, timeLeft } from "@/lib/booking";
import { keyFor, type Attempt } from "@/lib/idempotency";
import { formatRupees } from "@/lib/money";
import { payForBooking } from "@/lib/payments";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space } from "@/theme";
import type { ExtensionOptions } from "@/types/api.types";

function describe(minutes: number): string {
  return minutes < 60 ? `+${minutes} minutes` : `+${minutes / 60} ${minutes === 60 ? "hour" : "hours"}`;
}

/**
 * More time on a stay that is running.
 *
 * Every choice is shown, including the ones that can't be had, each with the
 * reason -- "booked from 6:00 PM" tells a driver whether to move the car,
 * where a missing option would only make them wonder. The extra time is held
 * for them the moment they choose it, and becomes theirs once paid.
 */
export default function ExtendScreen() {
  const { token, isRestoring } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const now = useNow();

  const [data, setData] = useState<ExtensionOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [payNote, setPayNote] = useState<string | null>(null);
  const attempt = useRef<Attempt | null>(null);

  const load = useCallback(async () => {
    if (!token || !id) return;
    try {
      const result = await bookingsApi.extensionOptions(token, id);
      setData(result);
      setLoadError(null);
      setMinutes((current) => current ?? result.options.find((o) => o.available)?.minutes ?? null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Could not load extension options.");
    }
  }, [token, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const pay = async (bookingId: string, amount: string) => {
    if (!token) return;
    const outcome = await payForBooking({ token, bookingId, amount, method: "UPI" });
    if (outcome.status === "PAID") {
      router.replace({ pathname: "/booking/[id]", params: { id: id! } });
    } else if (outcome.status === "FAILED") {
      setPayNote(`Payment couldn't be completed. ${outcome.message}`);
    } else if (outcome.status === "NOT_CONFIGURED") {
      setPayNote(
        "Online payment isn't switched on in this version yet. The extra time is held for you for 15 minutes, but it isn't yours until it's paid."
      );
    }
  };

  const { run: hold, busy, error } = useAsyncAction(async () => {
    if (!token || !id || minutes === null) return;
    // One key per choice: a retry after a dropped response replays the same
    // hold, while picking a different length is a new attempt.
    const idempotencyKey = keyFor(attempt, `${id}|${minutes}`);
    const { extensionId } = await bookingsApi.createExtension(token, id, { minutes, idempotencyKey });
    await load();
    const chosen = data?.options.find((o) => o.minutes === minutes);
    await pay(extensionId, chosen?.amount ?? "0");
  });

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  const back = () =>
    router.canGoBack() ? router.back() : router.replace({ pathname: "/booking/[id]", params: { id: id! } });

  const selected = data?.options.find((o) => o.minutes === minutes && o.available) ?? null;
  const noneAvailable = data !== null && data.options.every((o) => !o.available);
  const blockedReason = data?.options.find((o) => !o.available)?.reason ?? null;

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader title="Extend parking" onBack={back} />

        <ScrollView contentContainerStyle={s.body}>
          {loadError ? <ErrorNotice message={loadError} /> : null}

          {!data ? (
            loadError ? null : <ActivityIndicator color={colors.ink} style={s.loading} />
          ) : data.pending ? (
            <View style={s.gap}>
              <Text style={s.label}>WAITING FOR PAYMENT</Text>
              <Text style={s.big}>Extra time until {clockTime(data.pending.endsAt)}</Text>
              <Text style={s.muted}>
                Held for you for {data.pending.holdExpiresAt ? timeLeft(data.pending.holdExpiresAt, now) : "a few minutes"}{" "}
                more.
              </Text>
              <Button
                label={`Pay ${formatRupees(data.pending.amount)} & Extend`}
                size="lg"
                onPress={() => void pay(data.pending!.id, data.pending!.amount)}
              />
              {payNote ? <Text style={s.note}>{payNote}</Text> : null}
            </View>
          ) : (
            <>
              <View style={s.gap4}>
                <Text style={s.muted}>Current booking</Text>
                <Text style={s.big}>Ends at {clockTime(data.currentEndsAt)}</Text>
              </View>

              <View style={s.gap}>
                <Text style={s.label}>EXTEND TO</Text>
                {data.options.map((option) => {
                  const on = option.minutes === minutes && option.available;
                  return (
                    <Pressable
                      key={option.minutes}
                      disabled={!option.available}
                      onPress={() => setMinutes(option.minutes)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on, disabled: !option.available }}
                      style={[s.option, on && s.optionOn, !option.available && s.optionOff]}
                    >
                      <View style={s.flex}>
                        <Text style={[s.optionTitle, !option.available && s.offText]}>
                          Until {clockTime(option.endsAt)}
                        </Text>
                        <Text style={s.optionSub}>
                          {option.available ? describe(option.minutes) : option.reason}
                        </Text>
                      </View>
                      {option.available ? (
                        <Text style={s.optionPrice}>{formatRupees(option.amount)}</Text>
                      ) : (
                        <LockIcon size={17} color={colors.inkMuted} />
                      )}
                    </Pressable>
                  );
                })}
              </View>

              {data.unavailableAfter ? (
                <View style={s.notice}>
                  <Text style={s.noticeTitle}>
                    {noneAvailable
                      ? `Parking is unavailable after ${clockTime(data.currentEndsAt)}.`
                      : `Parking is unavailable after ${clockTime(data.unavailableAfter)}.`}
                  </Text>
                  {blockedReason ? <Text style={s.noticeBody}>{blockedReason}</Text> : null}
                </View>
              ) : null}

              {noneAvailable ? (
                <Button label="Find Parking Nearby" onPress={() => router.push("/home")} />
              ) : selected ? (
                <>
                  <View style={s.summary}>
                    <DataRow label="New end time" value={clockTime(selected.endsAt)} />
                    <DataRow label="Additional amount" value={formatRupees(selected.amount)} />
                  </View>
                  {error ? <ErrorNotice message={error} /> : null}
                  <Button
                    label={`Pay ${formatRupees(selected.amount)} & Extend`}
                    size="lg"
                    onPress={hold}
                    busy={busy}
                  />
                  {payNote ? <Text style={s.note}>{payNote}</Text> : null}
                </>
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
  loading: { paddingVertical: space.xxl },
  gap: { gap: space.sm },
  gap4: { gap: 4 },
  flex: { flex: 1, gap: 2 },
  label: { fontSize: 12, fontWeight: "700", letterSpacing: 1.2, color: colors.inkMuted },
  big: { fontSize: 21, fontWeight: "700", color: colors.ink },
  muted: { fontSize: 14, color: colors.inkMuted },
  option: {
    minHeight: 64,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm + 2,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
  },
  optionOn: { borderWidth: 2, borderColor: colors.ink },
  optionOff: { backgroundColor: colors.canvas, borderStyle: "dashed" },
  optionTitle: { fontSize: 16, fontWeight: "700", color: colors.ink },
  offText: { color: colors.inkMuted },
  optionSub: { fontSize: 13, color: colors.inkMuted },
  optionPrice: { fontSize: 16, fontWeight: "700", color: colors.ink },
  notice: { backgroundColor: colors.accentSurface, borderRadius: radius.md, padding: space.lg, gap: 4 },
  noticeTitle: { fontSize: 15, fontWeight: "700", color: colors.accentInk },
  noticeBody: { fontSize: 13, lineHeight: 19, color: colors.accentInk },
  summary: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  note: { fontSize: 13, lineHeight: 19, color: colors.accentInk, fontWeight: "600" },
});
