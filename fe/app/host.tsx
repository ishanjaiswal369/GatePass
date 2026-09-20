import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
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
function ListingStatusCard({ spot }: { spot: SpotListing | null }) {
  const { heading, body, tone } = describe(spot);

  return (
    <View style={[s.status, tone === "good" && s.statusGood, tone === "warn" && s.statusWarn]}>
      <Text style={s.statusHeading}>{heading}</Text>
      <Text style={s.statusBody}>{body}</Text>
    </View>
  );
}

function describe(spot: SpotListing | null): {
  heading: string;
  body: string;
  tone: "neutral" | "good" | "warn";
} {
  if (!spot || spot.status === "DRAFT") {
    return {
      heading: "Listing not finished",
      body: "Your spot is saved as a draft. Finish the remaining steps to send it for review.",
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
      body: spot.rejectionReason ?? "Your spot is offline. Contact support to put it back.",
      tone: "warn",
    };
  }

  return {
    heading: "Live",
    body: "Drivers nearby can find and book your spot.",
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
 */
export default function HostScreen() {
  const { token, user, setUser, isRestoring } = useSession();
  // Read from the session every render, never captured in initial state: after
  // a reload `user` is null until the session restores.
  const isHost = user?.hasHostProfile;
  const insets = useScreenInsets();
  const [profile, setProfile] = useState<HostProfile | null>(null);
  const [availability, setAvailability] = useState<HostAvailabilityRow[]>([]);
  const [spot, setSpot] = useState<SpotListing | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);



  useEffect(() => {
    // Not a host: onboarding needs nothing from the server.
    if (!token || isHost === false) return;

    let cancelled = false;

    hostApi
      .getProfile(token)
      .then(async ({ profile: found }) => {
        if (cancelled) return;
        setProfile(found);

        if (found) {
          const [{ availability: windows }, { spots }] = await Promise.all([
            hostApi.listAvailability(token),
            spotListingApi.list(token),
          ]);
          if (cancelled) return;
          setAvailability(windows);
          setSpot(spots[0] ?? null);
        }
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
  }, [token, isHost]);

  const [error] = useState<string | null>(null);

  const { run: toggleWindow } = useAsyncAction(
    async (id: string, next: boolean) => {
      if (!token) return;
      const updated = await hostApi.setAvailabilityActive(token, id, next);
      setAvailability((rows) =>
        rows.map((row) => (row.id === id ? updated : row))
      );
    }
  );

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
                  <Text style={s.title}>Your spot</Text>
                </View>
              ) : null}
              <ActivityIndicator color={colors.ink} style={s.loading} />
            </>
          ) : profile ? (
            <>
              <View style={s.heading}>
                <Text style={s.title}>Your spot</Text>
                <Text style={s.sub}>
                  {profile.addressLine}, {profile.city}
                </Text>
              </View>

              {/* What a host opens this screen to find out. Listing status,
                  not profile verification: the profile has said ACTIVE since
                  onboarding, while the listing is the thing that is or is not
                  earning. */}
              <ListingStatusCard spot={spot} />

              <Button
                label={
                  !spot || spot.status === "DRAFT" || spot.status === "REJECTED"
                    ? "Continue your listing"
                    : "View your listing"
                }
                size="lg"
                onPress={() => router.push("/host/spot")}
              />

              <Card heading="Spot">
                <DataRow label="City" value={profile.city} />
                <DataRow label="Pincode" value={profile.pincode} />
                {spot?.pricing?.length ? (
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
                <DataRow label="Photos" value={`${spot?.photos?.length ?? 0}`} />
              </Card>

              <Card heading={`Availability (${availability.length})`}>
                {availability.length === 0 ? (
                  <Text style={s.empty}>
                    No windows yet. Add one in the listing wizard — a spot with
                    no hours cannot be booked even once it is approved.
                  </Text>
                ) : (
                  availability.map((window) => (
                    <View key={window.id} style={s.window}>
                      <View style={s.windowCopy}>
                        <Text style={s.windowDay}>
                          {DAY_NAMES[window.dayOfWeek]}{" "}
                          {formatMinute(window.startMinute)}–
                          {formatMinute(window.endMinute)}
                        </Text>
                      </View>
                      <Switch
                        value={window.isActive}
                        onValueChange={(next) => toggleWindow(window.id, next)}
                        accessibilityLabel={`Availability on ${DAY_NAMES[window.dayOfWeek]}`}
                      />
                    </View>
                  ))
                )}
              </Card>
            </>
          ) : (
            <>
              <View style={s.heading}>
                <Text style={s.title}>Rent out your space</Text>
                <Text style={s.sub}>
                  Earn from a driveway, garage or parking bay you already have.
                </Text>
              </View>

              {error ? <ErrorNotice message={error} /> : null}

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
                couple of days.
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
  windowCopy: { gap: 2 },
  windowDay: { fontSize: 15, fontWeight: "600", color: colors.ink },
  windowPrice: { fontSize: 12, color: colors.inkFaint },
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
