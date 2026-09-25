import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { bookingsApi } from "@/api";
import {
  BottomNav,
  CarIcon,
  HomeHeader,
  PhoneFrame,
  RestoringScreen,
  SearchIcon,
  type NavKey,
} from "@/components/ui";
import { BookParkingForm } from "@/features/search/BookParkingForm";
import { useSession } from "@/providers/SessionProvider";
import { toParams, type SearchCriteria } from "@/lib/searchCriteria";
import { colors, space } from "@/theme";

/**
 * Two questions a driver arrives with, and nothing else.
 *
 * "Am I parked?" -- Already parked opens the running stay, or asks what they
 * mean when there isn't one. And "where do I park?" -- the search. The
 * Bookings tab keeps the full history.
 *
 * Event parking no longer has a list here: the product leads with a search,
 * not a feed. Its API and data are untouched.
 */
export default function HomeScreen() {
  const { token, user, isRestoring } = useSession();
  const [parkedNow, setParkedNow] = useState(false);

  /**
   * On focus rather than on mount: this screen stays mounted under the
   * booking flow, so a stay that started while the driver was elsewhere
   * would otherwise not light the Already parked tab until a restart.
   */
  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      let cancelled = false;

      bookingsApi
        .active(token)
        .then(({ booking }) => {
          if (!cancelled) setParkedNow(booking !== null);
        })
        // Not being parked is the normal state of this screen, so a failure
        // stays quiet rather than pushing a banner over the search form.
        .catch(() => undefined);

      return () => {
        cancelled = true;
      };
    }, [token])
  );

  const navigate = (key: NavKey) => {
    if (key === "bookings") router.push("/bookings");
    if (key === "host") router.push("/host");
    if (key === "profile") router.push("/account");
  };

  const runSearch = (criteria: SearchCriteria) =>
    router.push({ pathname: "/spots/results", params: toParams(criteria) });

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  const initial = (user?.firstName ?? user?.email ?? "?").charAt(0).toUpperCase();

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <HomeHeader
          initial={initial}
          headline="Where are you headed?"
          onPressProfile={() => router.push("/account")}
        />

        <View style={s.tabs}>
          <View style={s.segment}>
            <Pressable
              onPress={() => router.push("/parking")}
              accessibilityRole="button"
              accessibilityLabel={parkedNow ? "Already parked, you have a parking session running" : "Already parked"}
              style={({ pressed }) => [s.seg, pressed && s.segPressed]}
            >
              {parkedNow ? <View style={s.liveDot} /> : <CarIcon size={16} color={colors.inkMuted} />}
              <Text style={s.segText}>Already parked</Text>
            </Pressable>
            <View style={[s.seg, s.segOn]} accessibilityState={{ selected: true }}>
              <SearchIcon size={16} color={colors.ink} />
              <Text style={[s.segText, s.segTextOn]}>Book parking</Text>
            </View>
          </View>
        </View>

        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <BookParkingForm token={token} onSearch={runSearch} />
        </ScrollView>

        <BottomNav active="home" onNavigate={navigate} />
      </View>
    </PhoneFrame>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  tabs: { paddingHorizontal: 20, paddingTop: space.lg, paddingBottom: 14 },
  segment: { flexDirection: "row", gap: 4, backgroundColor: colors.canvas, borderRadius: 10, padding: 4 },
  seg: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  segOn: { backgroundColor: colors.surface },
  segPressed: { backgroundColor: colors.border },
  segText: { fontSize: 14, fontWeight: "600", color: colors.inkMuted },
  segTextOn: { color: colors.ink },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#16a34a" },
  body: { paddingHorizontal: 20, paddingBottom: 20, gap: 18 },
});
