import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, eventsApi } from "@/api";
import {
  ChevronLeftIcon,
  ErrorNotice,
  PhoneFrame,
  RestoringScreen,
} from "@/components/ui";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space } from "@/theme";
import type { EventDetail } from "@/types/api.types";

export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, isRestoring } = useSession();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !id) return;

    let cancelled = false;

    eventsApi
      .getById(token, id)
      .then((found) => {
        if (!cancelled) setEvent(found);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not load event");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token, id]);

  if (isRestoring) {
    return <RestoringScreen />;
  }

  if (!token) {
    return <Redirect href="/" />;
  }

  const when = event?.eventDate
    ? new Date(event.eventDate).toLocaleString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <PhoneFrame>
      <ScrollView contentContainerStyle={s.body}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={s.back}
        >
          <ChevronLeftIcon />
        </Pressable>

        {error ? <ErrorNotice message={error} /> : null}

        {!event ? (
          <ActivityIndicator color={colors.ink} style={s.loading} />
        ) : (
          <>
            <View style={s.heading}>
              <Text style={s.title}>{event.name}</Text>
              <Text style={s.sub}>
                {event.venueName}
                {when ? ` · ${when}` : ""}
              </Text>
              {event.organizer ? (
                <Text style={s.organizer}>by {event.organizer.name}</Text>
              ) : null}
            </View>

            <Text style={s.sectionTitle}>PARKING</Text>

            <View style={s.list}>
              {event.capacities.map((capacity) => {
                const soldOut = capacity.spotsLeft === 0;
                return (
                  <View key={capacity.id} style={s.option}>
                    <View style={s.optionCopy}>
                      <Text style={s.optionType}>{capacity.vehicleType}</Text>
                      <Text style={s.optionMeta}>
                        {soldOut ? "Sold out" : `${capacity.spotsLeft} left`}
                        {capacity.gate ? ` · ${capacity.gate}` : ""}
                      </Text>
                    </View>
                    <Text style={[s.optionPrice, soldOut && s.muted]}>
                      ₹{Math.round(Number(capacity.price))}
                    </Text>
                  </View>
                );
              })}
            </View>

            {/* Checkout is its own designed flow (design/Booking) and needs the
                Razorpay integration, which is not built. Saying so beats a
                button that opens nothing. */}
            <Text style={s.fine}>
              Booking opens once payments are live.
            </Text>
          </>
        )}
      </ScrollView>
    </PhoneFrame>
  );
}

const s = StyleSheet.create({
  body: { padding: 20, paddingTop: 56, gap: space.lg },
  back: { width: 44, height: 44, marginLeft: -12, justifyContent: "center" },
  loading: { paddingVertical: space.xl },
  heading: { gap: 6 },
  title: { fontSize: 27, fontWeight: "700", color: colors.ink, letterSpacing: -0.5, lineHeight: 33 },
  sub: { fontSize: 15, color: colors.inkMuted, lineHeight: 22 },
  organizer: { fontSize: 13, color: colors.inkFaint },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: colors.inkMuted,
  },
  list: { gap: space.md },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: space.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  optionCopy: { gap: 3 },
  optionType: { fontSize: 15, fontWeight: "600", color: colors.ink },
  optionMeta: { fontSize: 13, color: colors.inkMuted },
  optionPrice: { fontSize: 17, fontWeight: "700", color: colors.ink },
  muted: { color: colors.inkFaint },
  fine: { fontSize: 12, color: colors.inkFaint, lineHeight: 18 },
});
