import { Redirect, router } from "expo-router";
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  Button,
  CheckIcon,
  ClockIcon,
  DataRow,
  ErrorNotice,
  InfoIcon,
  PhoneFrame,
  RestoringScreen,
  SectionHeader,
  formatMinute,
} from "@/components/ui";
import { firstStepPath } from "@/constants/wizard";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { colors, radius, space, type } from "@/theme";
import type { SpotListing } from "@/types/api.types";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Where the listing stands once it has left the host's hands.
 *
 * This screen deliberately holds no introduction and no checklist. The Host
 * tab owns that, and having it here too meant a host met the same "Rent out
 * your space" page twice on the way in, with no way to tell the two apart.
 *
 * So anything still editable redirects straight into the wizard, and what is
 * left is the two things the wizard cannot show: what happened after Submit,
 * and what was submitted. It used to show only the first, on an otherwise
 * empty screen with nothing but a back chevron -- a host who had just
 * finished nine steps was shown one paragraph and no way onward.
 */
export default function SpotStatusScreen() {
  const { spot, loading, error, isRestoring, token } = useSpotDraft();

  if (isRestoring || loading) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  // No spot yet, or one the host can still change: there is nothing to report,
  // so go to the step that continues it. spot.id (when there is one) carries
  // forward so the wizard resumes this specific draft.
  if (!error && (!spot || spot.status === "DRAFT" || spot.status === "REJECTED")) {
    return <Redirect href={firstStepPath(spot?.id)} />;
  }

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <SectionHeader
          title="Your listing"
          sub={spot?.name}
          onBack={() => router.replace("/host")}
        />

        <ScrollView contentContainerStyle={s.body}>
          {error ? <ErrorNotice message={error} /> : null}

          {!spot ? (
            <ActivityIndicator color={colors.ink} style={s.loader} />
          ) : (
            <>
              <StatusCard spot={spot} />
              <SpotSummary spot={spot} />
            </>
          )}

          {/* Always, not only when published. This is the end of the wizard,
              and the Host tab is the only place left to go from it -- the
              back chevron alone left the screen reading as a dead end. */}
          <Button
            label="Back to your spots"
            variant="ghost"
            onPress={() => router.replace("/host")}
          />
        </ScrollView>
      </View>
    </PhoneFrame>
  );
}

/**
 * What happened, and what happens next.
 *
 * Under review says both gates out loud rather than "we are checking": a host
 * who is told only about the document reads an activated payout account as
 * the listing being stuck.
 */
type StatusCopy = {
  tone: "neutral" | "good" | "warn";
  title: string;
  body: string;
  steps: string[];
};

function StatusCard({ spot }: { spot: SpotListing }) {
  // Partial because the editable statuses never reach this screen -- they are
  // redirected into the wizard above -- and COMPLETED has no story to tell a
  // host yet. The fallback covers all of them.
  const table: Partial<Record<SpotListing["status"], StatusCopy>> = {
    PENDING_REVIEW: {
      tone: "neutral",
      title: "With us for review",
      body: "Two things have to clear before your spot goes live. You will get an email either way.",
      steps: [
        "We check the ownership proof you attached.",
        "Your payout account is verified, so you can be paid.",
      ],
    },
    PUBLISHED: {
      tone: "good",
      title: "Your spot is live",
      body: "Drivers nearby can find and book it now, during the hours you set.",
      steps: [],
    },
    ONGOING: {
      tone: "good",
      title: "Your spot is live",
      body: "Drivers nearby can find and book it now, during the hours you set.",
      steps: [],
    },
    SUSPENDED: {
      tone: "warn",
      title: "Your spot is paused",
      body: spot.rejectionReason ?? "It is offline for now. Contact support to put it back online.",
      steps: [],
    },
    CANCELLED: {
      tone: "warn",
      title: "This spot was removed",
      body: "It no longer appears in search. Add a new spot from the Host tab to start again.",
      steps: [],
    },
  };

  const copy: StatusCopy = table[spot.status] ?? {
    tone: "neutral",
    title: spot.status,
    body: "",
    steps: [],
  };

  return (
    <View
      style={[
        s.status,
        copy.tone === "good" && s.statusGood,
        copy.tone === "warn" && s.statusWarn,
      ]}
    >
      <View style={s.statusHead}>
        {copy.tone === "good" ? (
          <CheckIcon color={colors.success} size={16} />
        ) : copy.tone === "warn" ? (
          <InfoIcon color={colors.devInk} size={16} />
        ) : (
          <ClockIcon color={colors.inkMuted} size={16} />
        )}
        <Text style={s.statusTitle}>{copy.title}</Text>
      </View>

      <Text style={s.statusBody}>{copy.body}</Text>

      {copy.steps.map((step) => (
        <View key={step} style={s.step}>
          <View style={s.stepDot} />
          <Text style={s.stepText}>{step}</Text>
        </View>
      ))}
    </View>
  );
}

/** What was sent, so the host can check it without reopening nine steps. */
function SpotSummary({ spot }: { spot: SpotListing }) {
  const open = spot.availability.filter((window) => window.isActive);

  return (
    <View style={s.card}>
      {spot.photos.length > 0 ? (
        <Image
          source={{ uri: spot.photos[0].url }}
          style={s.cover}
          resizeMode="cover"
        />
      ) : null}

      <Text style={s.cardHeading}>What you submitted</Text>

      {spot.addressLine ? (
        <DataRow
          label="Address"
          value={[spot.addressLine, spot.city, spot.pincode]
            .filter(Boolean)
            .join(", ")}
        />
      ) : null}

      {spot.pricing.length > 0 ? (
        <DataRow
          label="Rates"
          value={spot.pricing
            .map(
              (rate) =>
                `${rate.vehicleType === "CAR" ? "Car" : "Bike"} ₹${Number(rate.pricePerHour)}/hr`
            )
            .join("  ·  ")}
        />
      ) : null}

      <DataRow label="Photos" value={`${spot.photos.length}`} />

      {open.length > 0 ? (
        <View style={s.hours}>
          <Text style={s.hoursLabel}>Open</Text>
          {open.map((window) => (
            <Text key={window.id} style={s.hoursRow}>
              {DAY_LABELS[window.dayOfWeek]}{" "}
              {window.startMinute === 0 && window.endMinute >= 1440
                ? "all day"
                : `${formatMinute(window.startMinute)}–${formatMinute(window.endMinute)}`}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  body: { padding: 20, paddingTop: space.xl, gap: space.lg },
  loader: { marginTop: space.xxl },
  status: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.canvas,
  },
  statusGood: { borderColor: colors.success, backgroundColor: "#f0fdf4" },
  statusWarn: { borderColor: colors.devBorder, backgroundColor: colors.devSurface },
  statusHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  statusTitle: { fontSize: 16, fontWeight: "700", color: colors.ink },
  statusBody: { fontSize: 13, lineHeight: 20, color: colors.inkMuted },
  step: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  stepDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.accent,
    marginTop: 7,
  },
  stepText: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.inkMuted },
  card: {
    gap: space.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
  },
  cover: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: radius.sm,
    backgroundColor: colors.border,
    marginBottom: space.xs,
  },
  cardHeading: {
    ...type.label,
    color: colors.inkMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  hours: { gap: 2, paddingTop: space.sm },
  hoursLabel: { fontSize: 13, color: colors.inkMuted },
  hoursRow: { fontSize: 14, fontWeight: "600", color: colors.ink },
});
