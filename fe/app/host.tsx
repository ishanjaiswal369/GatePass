import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, hostApi, spotListingApi } from "@/api";
import {
  BottomNav,
  Button,
  Card,
  ChevronRightIcon,
  ErrorNotice,
  PhoneFrame,
  type NavKey,
  PlusIcon,
  RatingBadge,
  RestoringScreen,
  StatusChip,
  type ChipTone,
  TrashIcon,
} from "@/components/ui";
import { firstStepPath } from "@/constants/wizard";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useScreenInsets } from "@/hooks/useScreenInsets";
import { clockTime } from "@/lib/booking";
import { formatRupees } from "@/lib/money";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space } from "@/theme";
import type { HostSummary, PayoutAccount, SpotListing } from "@/types/api.types";

/**
 * The Host tab.
 *
 * One nav item, two destinations: onboarding when no HostProfile exists, the
 * host's home when it does. The fork is `user.hasHostProfile`, which every
 * sign-in and /auth/me carries -- not a role claim, because a user can be a
 * driver and a host at once.
 *
 * The host's home is the prototype's: what they've earned this month and
 * what's available, today's bookings, and each space with where it stands
 * and the one thing to do next (Manage, View, Continue). Two requests: the
 * spaces (with the payout gate) and the summary.
 */
export default function HostScreen() {
  const { token, user, isRestoring } = useSession();
  // Read from the session every render, never captured in initial state:
  // after a reload `user` is null until the session restores.
  const isHost = user?.hasHostProfile;
  const insets = useScreenInsets();

  const [spots, setSpots] = useState<SpotListing[]>([]);
  const [payout, setPayout] = useState<PayoutAccount | null>(null);
  const [summary, setSummary] = useState<HostSummary | null>(null);
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

      Promise.all([spotListingApi.list(token), hostApi.summary(token)])
        .then(([{ spots: rows, payout: account }, sum]) => {
          if (cancelled) return;
          setSpots(rows);
          setPayout(account);
          setSummary(sum);
          setLoadError(null);
        })
        .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Could not load your spaces"))
        .finally(() => {
          if (!cancelled) setLoaded(true);
        });

      return () => {
        cancelled = true;
      };
    }, [token, isHost])
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
              {/* The frame shows now, the details follow. */}
              <Text style={s.title}>Host</Text>
              <ActivityIndicator color={colors.ink} style={s.loading} />
            </>
          ) : (
            <>
              <Text style={s.title}>Host</Text>

              {summary ? <EarningsCard summary={summary} /> : null}
              {summary ? <TodayCard summary={summary} /> : null}

              {payout ? <PayoutCard payout={payout} /> : null}

              <Text style={s.label}>MY PARKING SPACES</Text>
              {activeSpots.length === 0 ? (
                <Text style={s.empty}>No spaces yet. List one below to start taking bookings.</Text>
              ) : (
                activeSpots.map((spot) => (
                  <SpaceCard
                    key={spot.id}
                    spot={spot}
                    rating={summary?.ratings[spot.id] ?? null}
                    deleting={deletingId === spot.id}
                    onDelete={() => deleteSpot(spot.id)}
                  />
                ))
              )}

              {/* No request: the wizard's first step is what creates a spot,
                  and only once the host has named it. */}
              <Button label="List a Parking Space" icon={<PlusIcon size={18} color={colors.onPrimary} />} onPress={() => router.push(firstStepPath())} />
            </>
          )}
        </ScrollView>

        <BottomNav active="host" onNavigate={navigate} />
      </View>
    </PhoneFrame>
  );
}

/** This month after fees, and what's waiting to be paid out. Opens Earnings. */
function EarningsCard({ summary }: { summary: HostSummary }) {
  return (
    <Pressable
      onPress={() => router.push("/host/earnings")}
      accessibilityRole="button"
      accessibilityLabel={`This month after fees ${formatRupees(summary.month.net)}. Open earnings`}
      style={({ pressed }) => [s.earn, pressed && s.pressedDark]}
    >
      <View style={s.flex}>
        <Text style={s.earnLabel}>This month · after fees</Text>
        <Text style={s.earnValue}>{formatRupees(summary.month.net)}</Text>
        <Text style={s.earnSub}>
          {formatRupees(summary.available)} available for payout · {summary.month.bookings}{" "}
          {summary.month.bookings === 1 ? "booking" : "bookings"}
        </Text>
      </View>
      <ChevronRightIcon color={colors.onInkMuted} />
    </Pressable>
  );
}

/** "2 bookings today · Priya M. is parked now · Rahul S. at 3:00 PM". Opens Host bookings. */
function TodayCard({ summary }: { summary: HostSummary }) {
  const today = summary.today;
  const parked = today.filter((b) => b.phase === "ACTIVE");
  const next = today.filter((b) => b.phase === "UPCOMING");
  const line = [
    ...parked.map((b) => `${b.driver} is parked now`),
    ...next.slice(0, 2).map((b) => `${b.driver} at ${b.startsAt ? clockTime(b.startsAt) : ""}`),
  ].join(" · ");

  return (
    <Pressable
      onPress={() => router.push("/host/bookings")}
      accessibilityRole="button"
      style={({ pressed }) => [s.today, pressed && s.pressed]}
    >
      <View style={s.flex}>
        <Text style={s.todayTitle}>
          {today.length === 0 ? "No bookings today" : `${today.length} ${today.length === 1 ? "booking" : "bookings"} today`}
        </Text>
        <Text style={s.todaySub}>{line || "Your bookings, upcoming and past"}</Text>
      </View>
      <ChevronRightIcon />
    </Pressable>
  );
}

/** Where a space stands, in a chip and a line, and the one next step. */
function statusOf(spot: SpotListing): { label: string; tone: ChipTone; line: string | null } {
  switch (spot.status) {
    case "DRAFT":
      return { label: "Draft", tone: "neutral", line: "Not finished yet" };
    case "PENDING_REVIEW":
      return { label: "In review", tone: "warning", line: "Documents being checked · usually 48 hours" };
    case "REJECTED":
      return { label: "Not approved", tone: "danger", line: spot.rejectionReason ?? "Edit the listing and submit it again" };
    case "SUSPENDED":
      return { label: "Suspended", tone: "danger", line: spot.rejectionReason ?? "Contact support to put it back" };
    default:
      return spot.bookingsPausedAt
        ? { label: "Paused", tone: "warning", line: "Not taking new bookings" }
        : { label: "Active", tone: "success", line: null };
  }
}

function priceLine(spot: SpotListing): string {
  const rate = spot.pricing.find((row) => row.vehicleType === "CAR") ?? spot.pricing[0];
  if (!rate) return "Prices not set yet";
  return [
    `${formatRupees(rate.pricePerHour)}/hour`,
    rate.pricePerDay ? `${formatRupees(rate.pricePerDay)}/day` : null,
    rate.pricePerMonth ? `${formatRupees(rate.pricePerMonth)}/month` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function SpaceCard({
  spot,
  rating,
  deleting,
  onDelete,
}: {
  spot: SpotListing;
  rating: { rating: number; reviewCount: number } | null;
  deleting: boolean;
  onDelete: () => void;
}) {
  const status = statusOf(spot);
  const live = ["PUBLISHED", "ONGOING", "SUSPENDED"].includes(spot.status);
  const draft = spot.status === "DRAFT" || spot.status === "REJECTED";
  const where = [spot.addressLine, spot.city].filter(Boolean).join(", ");

  return (
    <View style={s.space}>
      <Text style={s.spaceName}>{spot.name}</Text>
      {where ? <Text style={s.muted}>{where}</Text> : null}
      <Text style={s.price}>{priceLine(spot)}</Text>

      <View style={s.spaceFoot}>
        <View style={s.chips}>
          <StatusChip label={status.label} tone={status.tone} />
          {live ? <RatingBadge rating={rating?.rating ?? null} count={rating?.reviewCount ?? 0} /> : null}
        </View>
        <View style={s.cta}>
          <Button
            label={live ? "Manage" : draft ? "Continue" : "View"}
            variant={live ? "primary" : "ghost"}
            onPress={() =>
              router.push(
                live
                  ? { pathname: "/host/listing/[id]", params: { id: spot.id } }
                  : draft
                    ? firstStepPath(spot.id)
                    : { pathname: "/host/spot", params: { id: spot.id } }
              )
            }
          />
        </View>
      </View>
      {status.line ? <Text style={s.muted}>{status.line}</Text> : null}

      {draft ? (
        <Button label="Delete draft" variant="ghost" busy={deleting} onPress={onDelete} leadingIcon={<TrashIcon color={colors.danger} />} />
      ) : null}
    </View>
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
  label: { fontSize: 12, fontWeight: "700", letterSpacing: 1.2, color: colors.inkMuted },
  loading: { paddingVertical: space.xl },
  empty: { fontSize: 14, color: colors.inkMuted, lineHeight: 21 },
  fine: { fontSize: 12, color: colors.inkFaint, lineHeight: 18 },
  flex: { flex: 1, gap: 3 },
  muted: { fontSize: 13, color: colors.inkMuted },
  earn: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.ink,
    borderRadius: 16,
    padding: 18,
  },
  pressedDark: { opacity: 0.92 },
  earnLabel: { fontSize: 13, color: colors.onInkMuted },
  earnValue: { fontSize: 30, fontWeight: "700", color: colors.onInk, letterSpacing: -0.5 },
  earnSub: { fontSize: 13, color: colors.onInkMuted },
  today: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
  },
  pressed: { backgroundColor: colors.canvas },
  todayTitle: { fontSize: 15, fontWeight: "700", color: colors.ink },
  todaySub: { fontSize: 13, color: colors.inkMuted },
  space: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.lg, gap: 4 },
  spaceName: { fontSize: 16, fontWeight: "700", color: colors.ink },
  price: { fontSize: 14, fontWeight: "600", color: colors.ink, marginTop: 2 },
  spaceFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm, marginTop: space.sm },
  chips: { flexDirection: "row", alignItems: "center", gap: space.sm, flexShrink: 1 },
  cta: { minWidth: 120 },
  status: {
    gap: 5,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.canvas,
  },
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
