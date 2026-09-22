import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
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
  formatMinute,
} from "@/components/ui";
import { firstStepPath } from "@/constants/wizard";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useScreenInsets } from "@/hooks/useScreenInsets";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space, type } from "@/theme";
import type {
  AvailabilityWindow,
  PayoutAccount,
  SpotListing,
} from "@/types/api.types";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * One nav item, two destinations: onboarding when no HostProfile exists, the
 * dashboard when it does. The fork is decided by `user.hasHostProfile`, which
 * every sign-in and /auth/me carries -- not by a role claim, because a user
 * can be a driver and a host at the same time. So a non-host lands on
 * onboarding with no request at all.
 *
 * The dashboard itself is one call. It used to be three -- the profile, every
 * spot, and every availability window -- which is two more round trips than
 * the screen has pieces: `/host/spots` carries each spot's own windows and
 * the payout gate alongside them, and the host's profile held nothing this
 * screen still shows.
 */
export default function HostScreen() {
  const { token, user, isRestoring } = useSession();
  // Read from the session every render, never captured in initial state:
  // after a reload `user` is null until the session restores.
  const isHost = user?.hasHostProfile;
  const insets = useScreenInsets();

  const [spots, setSpots] = useState<SpotListing[]>([]);
  const [payout, setPayout] = useState<PayoutAccount | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * On focus, not on mount. The wizard runs on top of this screen and returns
   * to it without remounting, so a spot that was just submitted -- or just
   * created -- would otherwise show whatever was true when the tab first
   * opened, which reads as a failed save.
   */
  useFocusEffect(
    useCallback(() => {
      if (!token || isHost !== true) {
        setLoaded(true);
        return;
      }

      let cancelled = false;

      spotListingApi
        .list(token)
        .then(({ spots: rows, payout: account }) => {
          if (cancelled) return;
          setSpots(rows);
          setPayout(account);
          setLoadError(null);
        })
        .catch((err) =>
          setLoadError(
            err instanceof ApiError ? err.message : "Could not load your spots"
          )
        )
        .finally(() => {
          if (!cancelled) setLoaded(true);
        });

      return () => {
        cancelled = true;
      };
    }, [token, isHost])
  );

  const { run: toggleWindow } = useAsyncAction(
    async (spotId: string, id: string, next: boolean) => {
      if (!token) return;
      const updated = await hostApi.setAvailabilityActive(token, id, next);

      setSpots((rows) =>
        rows.map((spot) =>
          spot.id === spotId
            ? {
                ...spot,
                availability: spot.availability.map((window) =>
                  window.id === id ? { ...window, ...updated } : window
                ),
              }
            : spot
        )
      );
    }
  );

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { run: deleteSpot } = useAsyncAction(async (id: string) => {
    if (!token) return;
    setDeletingId(id);
    try {
      await spotListingApi.deleteSpot(token, id);
      setSpots((rows) => rows.filter((row) => row.id !== id));
    } finally {
      setDeletingId(null);
    }
  });

  const navigate = (key: NavKey) => {
    if (key === "home") router.push("/home");
    if (key === "bookings") router.push("/bookings");
    if (key === "profile") router.push("/account");
  };

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  const activeSpots = spots.filter((spot) => spot.status !== "CANCELLED");

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScrollView contentContainerStyle={[s.body, { paddingTop: insets.top + 32 }]}>
          {loadError ? <ErrorNotice message={loadError} /> : null}

          {isHost !== true ? (
            <Onboarding />
          ) : !loaded ? (
            <>
              {/* The frame shows now, the details follow. A known host should
                  not watch a blank screen for one request. */}
              <View style={s.heading}>
                <Text style={s.title}>Your spots</Text>
              </View>
              <ActivityIndicator color={colors.ink} style={s.loading} />
            </>
          ) : (
            <>
              <View style={s.heading}>
                <Text style={s.title}>Your spots</Text>
                <Text style={s.sub}>
                  {activeSpots.length === 1 ? "1 listed" : `${activeSpots.length} listed`}
                </Text>
              </View>

              {payout ? <PayoutCard payout={payout} /> : null}

              {activeSpots.length === 0 ? (
                <Text style={s.empty}>
                  No spots yet. Add one below to start taking bookings.
                </Text>
              ) : (
                activeSpots.map((spot) => (
                  <SpotCard
                    key={spot.id}
                    spot={spot}
                    deleting={deletingId === spot.id}
                    onDelete={() => deleteSpot(spot.id)}
                    onToggleWindow={(id, next) => toggleWindow(spot.id, id, next)}
                  />
                ))
              )}

              {/* No request: the wizard's first step is what creates a spot,
                  and it does so only once the host has named it. Opening a
                  blank draft here left unnamed rows behind for anyone who
                  looked at the wizard and backed out. */}
              <Button
                label="Add another spot"
                onPress={() => router.push(firstStepPath())}
              />
            </>
          )}
        </ScrollView>

        <BottomNav active="host" onNavigate={navigate} />
      </View>
    </PhoneFrame>
  );
}

function SpotCard({
  spot,
  deleting,
  onDelete,
  onToggleWindow,
}: {
  spot: SpotListing;
  deleting: boolean;
  onDelete: () => void;
  onToggleWindow: (id: string, next: boolean) => void;
}) {
  const editable = spot.status === "DRAFT" || spot.status === "REJECTED";

  return (
    <Card heading={spot.name}>
      <ListingStatusCard spot={spot} />

      <Button
        label={editable ? "Continue this listing" : "View this listing"}
        onPress={() =>
          router.push(
            editable
              ? firstStepPath(spot.id)
              : { pathname: "/host/spot", params: { id: spot.id } }
          )
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

      {spot.availability.length === 0 ? (
        <Text style={s.empty}>
          No hours yet. This spot stays hidden until you set them in the wizard.
        </Text>
      ) : (
        spot.availability.map((window) => (
          <View key={window.id} style={s.window}>
            <Text style={s.windowDay}>{describeWindow(window)}</Text>
            <Switch
              value={window.isActive}
              onValueChange={(next) => onToggleWindow(window.id, next)}
              accessibilityLabel={`Availability on ${DAY_NAMES[window.dayOfWeek]}`}
            />
          </View>
        ))
      )}

      <Button
        label="Delete this spot"
        variant="danger"
        busy={deleting}
        onPress={onDelete}
        leadingIcon={<TrashIcon color={colors.danger} />}
      />
    </Card>
  );
}

/**
 * The payout gate, once, at the top -- not per spot.
 *
 * It is one account for the whole host, and it blocks every one of their
 * spots at the same time, so repeating it on each card would say the same
 * thing three times. Hidden once activated: a gate that is open is not news.
 */
function PayoutCard({ payout }: { payout: PayoutAccount }) {
  if (payout.payoutKycStatus === "ACTIVATED") return null;

  // Whatever the status says, a host with nothing stored has not really
  // submitted anything -- see the API's needsDetails.
  if (payout.needsDetails) {
    return (
      <View style={s.status}>
        <Text style={s.statusHeading}>No payout account yet</Text>
        <Text style={s.statusBody}>
          Your spots cannot go live until we know where to send your earnings.
          The listing wizard asks for this.
        </Text>
      </View>
    );
  }

  const copy = {
    NOT_STARTED: {
      title: "No payout account yet",
      body: "Your spots cannot go live until we know where to send your earnings. The listing wizard asks for this.",
    },
    PENDING: {
      title: "Payout details received",
      body: "We are sending them for verification.",
    },
    UNDER_REVIEW: {
      title: "Payout account being verified",
      body: `We are checking the account ending ${payout.accountNumberLast4 ?? "••••"}. This usually takes a day or two, and your spots go live once it clears.`,
    },
    REJECTED: {
      title: "Payout account could not be verified",
      body: "The details did not check out. Enter them again in the listing wizard.",
    },
  }[payout.payoutKycStatus];

  return (
    <View
      style={[
        s.status,
        payout.payoutKycStatus === "REJECTED" && s.statusWarn,
      ]}
    >
      <Text style={s.statusHeading}>{copy.title}</Text>
      <Text style={s.statusBody}>{copy.body}</Text>
    </View>
  );
}

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

function describeWindow(window: AvailabilityWindow): string {
  const day = DAY_NAMES[window.dayOfWeek];

  if (window.startMinute === 0 && window.endMinute >= 1440) {
    return `${day}  ·  all day`;
  }

  return `${day}  ·  ${formatMinute(window.startMinute)}–${formatMinute(window.endMinute)}`;
}

function Onboarding() {
  return (
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

      <Button label="Get started" size="lg" onPress={() => router.push(firstStepPath())} />

      <Text style={s.fine}>
        We check your ownership proof before a listing goes live, and your
        payout account has to be active. Both usually take a couple of days.
        You can list more than one spot once you are set up.
      </Text>
    </>
  );
}

function Need({ text }: { text: string }) {
  return (
    <View style={s.need}>
      <View style={s.needDot} />
      <Text style={s.needText}>{text}</Text>
    </View>
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
