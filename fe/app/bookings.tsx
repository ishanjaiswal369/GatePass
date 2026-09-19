import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, bookingsApi } from "@/api";
import {
  BottomNav,
  Card,
  DataRow,
  ErrorNotice,
  PhoneFrame,
  SegmentedControl,
  type NavKey,
  RestoringScreen,
} from "@/components/ui";
import { useSession } from "@/providers/SessionProvider";
import { colors, space } from "@/theme";
import type { BookingRow } from "@/types/api.types";

type Scope = "upcoming" | "past";

const SCOPES = [
  { value: "upcoming" as const, label: "Upcoming" },
  { value: "past" as const, label: "Past" },
];

export default function BookingsScreen() {
  const { token, isRestoring } = useSession();
  const [scope, setScope] = useState<Scope>("upcoming");
  const [rows, setRows] = useState<BookingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    setRows(null);

    bookingsApi
      .list(token, scope)
      .then((page) => {
        if (!cancelled) setRows(page.items);
      })
      .catch((err) => {
        if (cancelled) return;
        setRows([]);
        setError(
          err instanceof ApiError ? err.message : "Could not load bookings"
        );
      });

    return () => {
      cancelled = true;
    };
  }, [token, scope]);

  const navigate = (key: NavKey) => {
    if (key === "home") router.push("/home");
    if (key === "host") router.push("/host");
    if (key === "profile") router.push("/account");
  };

  if (isRestoring) {
    return <RestoringScreen />;
  }

  if (!token) {
    return <Redirect href="/" />;
  }

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <View style={s.head}>
          <Text style={s.title}>Bookings</Text>
          <SegmentedControl segments={SCOPES} value={scope} onChange={setScope} />
        </View>

        <ScrollView contentContainerStyle={s.body}>
          {error ? <ErrorNotice message={error} /> : null}

          {rows === null ? (
            <ActivityIndicator color={colors.ink} style={s.loading} />
          ) : rows.length === 0 ? (
            <Text style={s.empty}>
              {scope === "upcoming"
                ? "Nothing booked yet. Events on the home screen are the place to start."
                : "No past bookings."}
            </Text>
          ) : (
            rows.map((row) => (
              <Card key={row.id} heading={row.parkingCapacity.listing.name}>
                <DataRow label="Venue" value={row.parkingCapacity.listing.venueName} />
                <DataRow label="Vehicle" value={row.vehicleNumber} />
                <DataRow label="Spots" value={String(row.quantity)} />
                <DataRow label="Amount" value={`₹${Math.round(Number(row.amount))}`} />
                <DataRow label="Status" value={row.status} />
              </Card>
            ))
          )}
        </ScrollView>

        <BottomNav active="bookings" onNavigate={navigate} />
      </View>
    </PhoneFrame>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  head: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: space.lg, gap: space.lg },
  title: { fontSize: 27, fontWeight: "700", color: colors.ink, letterSpacing: -0.5 },
  body: { paddingHorizontal: 20, paddingBottom: 20, gap: space.md },
  loading: { paddingVertical: space.xl },
  empty: { fontSize: 14, color: colors.inkMuted, lineHeight: 21 },
});
