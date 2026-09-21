import { Redirect, router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { ApiError, hostApi, spotListingApi } from "@/api";
import {
  BottomNav,
  Button,
  Card,
  DataRow,
  ErrorNotice,
  PhoneFrame,
  type NavKey,
  RestoringScreen,
  TrashIcon,
} from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useScreenInsets } from "@/hooks/useScreenInsets";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space } from "@/theme";
import type {
  HostAvailabilityRow,
  HostProfile,
  SpotListing,
} from "@/types/api.types";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Where the listing stands, and what moves it forward.
 *
 * Deliberately says what is outstanding rather than only naming a state: a
 * host reading "PENDING_REVIEW" learns nothing they can act on.
 */
function ListingStatusCard({ spot }: { spot: SpotListing }) {
  const { heading, body, tone } = describe(spot);

  return (
    <View style={[s.status, tone === "good" && s.statusGood, tone === "warn" && s.statusWarn]}>
      <Text style={s.statusHeading}>{heading}</Text>
      <Text style={s.statusBody}>{body}</Text>
    </View>
  );
}

function describe(spot: SpotListing): {
  heading: string;
  body: string;
  tone: "neutral" | "good" | "warn";
} {
  if (spot.status === "DRAFT") {
    return {
      heading: "Listing not finished",
      body: "Saved as a draft. Finish the remaining steps to send it for review.",
      tone: "neutral",
    };
  }

  if (spot.status === "PENDING_REVIEW") {
    return {
      heading: "With us for review",
      body: "We are checking your ownership proof. It goes live once that clears and your payout account is active.",
      tone: "neutral",
    };
  }

  if (spot.status === "REJECTED") {
    return {
      heading: "Not approved",
      body: spot.rejectionReason ?? "Something was missing. Edit your listing and submit it again.",
      tone: "warn",
    };
  }

  if (spot.status === "SUSPENDED") {
    return {
      heading: "Paused",
      body: spot.rejectionReason ?? "This spot is offline. Contact support to put it back.",
      tone: "warn",
    };
  }

  return {
    heading: "Live",
    body: "Drivers nearby can find and book this spot.",
    tone: "good",
  };
}

function Need({ text }: { text: string }) {
  return (
    <View style={s.need}>
      <View style={s.needDot} />
      <Text style={s.needText}>{text}</Text>
    </View>
  );
}

function formatMinute(minute: number) {
  // End-of-day is stored as 1440, which "% 24" would render as 00:00 -- a
  // window reading "18:00-00:00" looks like a typo, and "00:00-00:00" looks
  // broken.
  if (minute >= 1440) return "24:00";
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/**
 * One nav item, two destinations: onboarding when no HostProfile exists, the
 * dashboard when it does. The fork is decided by the API, not by a role claim
 * -- a user can be a driver and a host at the same time.
 *
 * Which one to show comes from `user.hasHostProfile`, which every sign-in and
 * /auth/me carries. So a non-host lands on onboarding with no request at all,
 * and a host sees the dashboard frame at once while its details load.
 *
 * A host can list more than one spot. Every spot the host has (minus ones
 * they have since deleted) gets its own card, with its own status,
 * availability and a delete action; availability across every spot is
 * fetched in one call and grouped client-side by `listingId`, because a host
 * with a handful of spots does not need one round trip per card.
 */
export default function HostScreen() {
  const { token, user, setUser, isRestoring } = useSession();
  // Read from the session every render, never captured in initial state: after
  // a reload `user` is null until the session restores.
  const isHost = user?.hasHostProfile;
  const insets = useScreenInsets();
  const [profile, setProfile] = useState<HostProfile | null>(null);
  const [spots, setSpots] = useState<SpotListing[]>([]);
  const [availability, setAvailability] = useState<HostAvailabilityRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    if (!token) return;

    const [{ availability: windows }, { spots: rows }] = await Promise.all([
      hostApi.listAvailability(token),
      spotListingApi.list(token),
    ]);

    setAvailability(windows);
    setSpots(rows);
  }, [token]);

  useEffect(() => {
    // Not a host: onboarding needs nothing from the server.
    if (!token || isHost === false) return;

    let cancelled = false;

    hostApi
      .getProfile(token)
      .then(async ({ profile: found }) => {
        if (cancelled) return;
        setProfile(found);

        if (found) await loadDashboard();
      })
      .catch((err) =>
        setLoadError(err instanceof ApiError ? err.message : "Could not load host")
      )
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [token, isHost, loadDashboard]);

  const { run: toggleWindow } = useAsyncAction(
    async (id: string, next: boolean) => {
      if (!token) return;
      const updated = await hostApi.setAvailabilityActive(token, id, next);
      setAvailability((rows) =>
        rows.map((row) => (row.id === id ? updated : row))
      );
    }
  );

  const { run: addSpot, busy: addingSpot } = useAsyncAction(async () => {
    if (!token) return;
    const created = await spotListingApi.create(token);
    // Straight into the wizard -- a blank draft has nothing to report on the
    // status screen, so there is no reason to detour through it.
    router.push({ pathname: "/host/spot/address", params: { id: created.id } });
  });

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { run: deleteSpot } = useAsyncAction(async (id: string) => {
    if (!token) return;
    setDeletingId(id);
    try {
      await spotListingApi.deleteSpot(token, id);
      setSpots((rows) => rows.filter((row) => row.id !== id));
      setAvailability((rows) => rows.filter((row) => row.listingId !== id));
    } finally {
      setDeletingId(null);
    }
  });

  const navigate = (key: NavKey) => {
    if (key === "home") router.push("/home");
    if (key === "bookings") router.push("/bookings");
    if (key === "profile") router.push("/account");
  };

  if (isRestoring) {
    return <RestoringScreen />;
  }

  if (!token) {
    return <Redirect href="/" />;
  }

  const activeSpots = spots.filter((spot) => spot.status !== "CANCELLED");

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScrollView contentContainerStyle={[s.body, { paddingTop: insets.top + 32 }]}>
          {loadError ? <ErrorNotice message={loadError} /> : null}

          {/* Spinner only when there is something to wait for. A known
              non-host skips it and gets onboarding on first paint. */}
          {!profile && !loaded && isHost !== false ? (
            <>
              {/* Known host: the dashboard frame shows now, details follow. */}
              {isHost ? (
                <View style={s.heading}>
                  <Text style={s.title}>Your spots</Text>
                </View>
              ) : null}
              <ActivityIndicator color={colors.ink} style={s.loading} />
            </>
          ) : profile ? (
            <>
              <View style={s.heading}>
                <Text style={s.title}>Your spots</Text>
                <Text style={s.sub}>{activeSpots.length} listed</Text>
              </View>

              <Card heading="Host details">
                <DataRow label="City" value={profile.city} />
                <DataRow label="Pincode" value={profile.pincode} />
              </Card>

              {activeSpots.length === 0 ? (
                <Text style={s.empty}>
                  No spots yet. Add one below to start taking bookings.
                </Text>
              ) : (
                activeSpots.map((spot) => {
                  const windows = availability.filter(
                    (window) => window.listingId === spot.id
                  );

                  return (
                    <Card key={spot.id} heading={spot.name}>
                      <ListingStatusCard spot={spot} />

                      <Button
                        label={
                          spot.status === "DRAFT" || spot.status === "REJECTED"
                            ? "Continue this listing"
                            : "View this listing"
                        }
                        onPress={() =>
                          router.push({ pathname: "/host/spot", params: { id: spot.id } })
                        }
                      />

                      {spot.city ? <DataRow label="City" value={spot.city} /> : null}
                      {spot.pricing.length > 0 ? (
                        <DataRow
                          label="Rates"
                          value={spot.pricing
                            .map(
                              (rate) =>
                                `${rate.vehicleType === "CAR" ? "Car" : "Bike"} ₹${Number(rate.pricePerHour)}`
                            )
                            .join("  ·  ")}
                        />
                      ) : null}
                      <DataRow label="Photos" value={`${spot.photos.length}`} />

                      {windows.length === 0 ? (
                        <Text style={s.empty}>
                          No windows yet. This spot stays hidden until you add
                          one in the wizard.
                        </Text>
                      ) : (
                        windows.map((window) => (
                          <View key={window.id} style={s.window}>
                            <Text style={s.windowDay}>
                              {DAY_NAMES[window.dayOfWeek]}{" "}
                              {formatMinute(window.startMinute)}–
                              {formatMinute(window.endMinute)}
                            </Text>
                            <Switch
                              value={window.isActive}
                              onValueChange={(next) => toggleWindow(window.id, next)}
                              accessibilityLabel={`Availability on ${DAY_NAMES[window.dayOfWeek]}`}
                            />
                          </View>
                        ))
                      )}

                      <Button
                        label="Delete this spot"
                        variant="danger"
                        busy={deletingId === spot.id}
                        onPress={() => deleteSpot(spot.id)}
                        leadingIcon={<TrashIcon color={colors.danger} />}
                      />
                    </Card>
                  );
                })
              )}

              <Button
                label="Add another spot"
                busy={addingSpot}
                onPress={addSpot}
              />
            </>
          ) : (
            <>
              <View style={s.heading}>
                <Text style={s.title}>Rent out your space</Text>
                <Text style={s.sub}>
                  Earn from a driveway, garage or parking bay you already have.
                </Text>
              </View>

              <Card heading="What you will need">
                <View style={s.needs}>
                  <Need text="Photos of the space" />
                  <Need text="The address, and a pin you can move to the exact entrance" />
                  <Need text="Proof you may rent it out — an electricity bill or property tax receipt" />
                  <Need text="Your PAN and bank details, so you can be paid" />
                </View>
              </Card>

              {/* Straight into the wizard. The address used to be collected
                  here first, which asked a host for it twice and left two
                  copies free to disagree; the wizard's first step owns it now. */}
              <Button
                label="Get started"
                size="lg"
                onPress={() => router.push("/host/spot")}
              />

              <Text style={s.fine}>
                We check your ownership proof before a listing goes live, and
                your payout account has to be active. Both usually take a
                couple of days. You can list more than one spot once you are
                set up.
              </Text>
            </>
          )}
        </ScrollView>

        <BottomNav active="host" onNavigate={navigate} />
      </View>
    </PhoneFrame>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  body: { paddingHorizontal: 20, paddingBottom: 20, gap: space.lg },
  heading: { gap: 6 },
  title: { fontSize: 27, fontWeight: "700", color: colors.ink, letterSpacing: -0.5 },
  sub: { fontSize: 15, color: colors.inkMuted, lineHeight: 22 },
  loading: { paddingVertical: space.xl },
  empty: { fontSize: 14, color: colors.inkMuted, lineHeight: 21 },
  window: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  windowDay: { fontSize: 15, fontWeight: "600", color: colors.ink },
  fine: { fontSize: 12, color: colors.inkFaint, lineHeight: 18 },
  status: {
    gap: 5,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.canvas,
  },
  statusGood: { borderColor: colors.success, backgroundColor: "#f0fdf4" },
  statusWarn: { borderColor: colors.devBorder, backgroundColor: colors.devSurface },
  statusHeading: { fontSize: 16, fontWeight: "700", color: colors.ink },
  statusBody: { fontSize: 13, lineHeight: 19, color: colors.inkMuted },
  needs: { gap: space.md, paddingTop: space.xs },
  need: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  needDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.accent,
    marginTop: 7,
  },
  needText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.inkMuted },
});
