import { Redirect, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, hostApi } from "@/api";
import type { HostBookingScope } from "@/api/host.api";
import { EmptyState, CalendarIcon, ErrorNotice, PhoneFrame, RestoringScreen, ScreenHeader, SegmentedControl } from "@/components/ui";
import { HostBookingCard } from "@/features/host/HostBookingCard";
import { useSession } from "@/providers/SessionProvider";
import { colors, space } from "@/theme";
import type { HostBooking } from "@/types/api.types";

const TABS: { value: HostBookingScope; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

/**
 * Bookings on the host's spaces, in the prototype's four tabs. With
 * `?listingId=` it's one space (from its dashboard); without, all of them
 * (from the Host tab's "today" card). Only paid bookings -- an unpaid hold
 * isn't a booking yet and the host has nothing to act on.
 */
export default function HostBookingsScreen() {
  const { token, isRestoring } = useSession();
  const { listingId, tab } = useLocalSearchParams<{ listingId?: string; tab?: HostBookingScope }>();
  const [scope, setScope] = useState<HostBookingScope>(TABS.some((t) => t.value === tab) ? tab! : "upcoming");
  const [items, setItems] = useState<HostBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setItems(null);
    try {
      setItems((await hostApi.bookings(token, scope, listingId)).items);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? "This space isn't yours, or no longer exists." : "Could not load bookings.");
    }
  }, [token, scope, listingId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader title="Bookings" onBack={() => (router.canGoBack() ? router.back() : router.replace("/host"))} />
        <View style={s.tabs}>
          <SegmentedControl segments={TABS} value={scope} onChange={setScope} />
        </View>
        <ScrollView contentContainerStyle={s.body}>
          {error ? <ErrorNotice message={error} /> : null}
          {items === null ? (
            error ? null : <ActivityIndicator color={colors.ink} style={s.loading} />
          ) : items.length === 0 ? (
            <EmptyState icon={<CalendarIcon size={26} color={colors.ink} />} title={`No ${scope} bookings`} body="Paid bookings on your spaces show up here." />
          ) : (
            items.map((b) => <HostBookingCard key={b.id} booking={b} showSpace={!listingId} />)
          )}
          <Text style={s.fine}>
            You see a driver's first name and vehicle so you can let them in. Phone numbers stay private.
          </Text>
        </ScrollView>
      </View>
    </PhoneFrame>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  tabs: { paddingHorizontal: 20, paddingTop: space.lg },
  body: { padding: 20, gap: space.md, paddingBottom: 32 },
  loading: { paddingVertical: space.xxl },
  fine: { fontSize: 12, lineHeight: 18, color: colors.inkMuted, textAlign: "center" },
});
