import { Redirect, router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { spotListingApi } from "@/api";
import {
  CheckIcon,
  InfoIcon,
  RestoringScreen,
  WizardShell,
} from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { TOTAL_STEPS, stepNumber } from "@/constants/wizard";
import { colors, radius, space, type } from "@/theme";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Step 9. What the host is about to submit.
 *
 * Readiness comes from the server rather than being recomputed here. The API
 * is what decides whether Submit is accepted, so a client-side checklist could
 * disagree with it -- and would, the first time a rule changed on one side.
 */
export default function ReviewScreen() {
  const { spot, loading, isRestoring, token, reload } = useSpotDraft();

  const [missing, setMissing] = useState<string[]>([]);
  const [checking, setChecking] = useState(true);

  const check = useCallback(async () => {
    if (!token || !spot) return;

    setChecking(true);
    try {
      const { missing: gaps } = await spotListingApi.readiness(token, spot.id);
      setMissing(gaps);
    } finally {
      setChecking(false);
    }
  }, [token, spot]);

  useEffect(() => {
    void check();
  }, [check]);

  const { run: submit, busy, error } = useAsyncAction(async () => {
    if (!token || !spot) return;

    await spotListingApi.submit(token, spot.id);
    await reload();
    router.replace({ pathname: "/host/spot", params: { id: spot.id } });
  });

  if (isRestoring || loading) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;
  if (!spot) return <Redirect href="/host/spot" />;

  const ready = missing.length === 0 && !checking;
  const days = [...new Set((spot.availability ?? []).filter((w) => w.isActive).map((w) => w.dayOfWeek))].sort();

  return (
    <WizardShell
      title="Review"
      sub="Check it over, then send it to us."
      step={stepNumber("review")}
      totalSteps={TOTAL_STEPS}
      onBack={() => router.back()}
      onContinue={submit}
      canContinue={ready}
      continueLabel="Submit for review"
      busy={busy}
      error={error}
      footerNote={
        ready
          ? "We check your document, then your spot goes live once your payout account is active."
          : "Finish the steps above to submit."
      }
    >
      {missing.length > 0 ? (
        <View style={s.gaps}>
          <View style={s.gapsHead}>
            <InfoIcon color={colors.devInk} size={16} />
            <Text style={s.gapsTitle}>Still to do</Text>
          </View>
          {missing.map((gap) => (
            <Text key={gap} style={s.gap}>
              • {gap}
            </Text>
          ))}
        </View>
      ) : null}

      {spot.photos.length > 0 ? (
        <Image
          source={{ uri: spot.photos[0].url }}
          style={s.cover}
          resizeMode="cover"
        />
      ) : null}

      <View style={s.card}>
        <Text style={s.name}>{spot.name}</Text>
        <Text style={s.venue}>{spot.venueName}</Text>
      </View>

      <Summary label="Space" value={spaceTypeLabel(spot.spaceType)} />
      <Summary
        label="Rates"
        value={
          spot.pricing.length > 0
            ? spot.pricing
                .map((row) => `${row.vehicleType === "CAR" ? "Car" : "Bike"} ₹${Number(row.pricePerHour)}/hr`)
                .join("  ·  ")
            : "Not set"
        }
      />
      <Summary
        label="Open"
        value={
          days.length === 7
            ? "Every day"
            : days.length > 0
              ? days.map((day) => DAY_LABELS[day]).join(", ")
              : "Not set"
        }
      />
      <Summary label="Photos" value={`${spot.photos.length} attached`} />
      <Summary
        label="Ownership proof"
        value={spot.ownershipDocUrl ? "Attached" : "Missing"}
        good={Boolean(spot.ownershipDocUrl)}
      />
      <Summary
        label="Permission confirmed"
        value={spot.warrantyAcceptedAt ? "Yes" : "Not yet"}
        good={Boolean(spot.warrantyAcceptedAt)}
      />

      {spot.accessInstructions ? (
        <View style={s.card}>
          <Text style={s.blockLabel}>Getting in</Text>
          <Text style={s.blockBody}>{spot.accessInstructions}</Text>
        </View>
      ) : null}
    </WizardShell>
  );
}

function Summary({
  label,
  value,
  good,
}: {
  label: string;
  value: string;
  good?: boolean;
}) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <View style={s.rowValueWrap}>
        {good ? <CheckIcon color={colors.success} size={14} /> : null}
        <Text style={s.rowValue}>{value}</Text>
      </View>
    </View>
  );
}

function spaceTypeLabel(spaceType: string | null) {
  if (spaceType === "DRIVEWAY") return "Driveway";
  if (spaceType === "GARAGE") return "Garage";
  if (spaceType === "CAR_PARK") return "Car park bay";
  return "Not set";
}

const s = StyleSheet.create({
  gaps: {
    gap: 4,
    backgroundColor: colors.devSurface,
    borderWidth: 1,
    borderColor: colors.devBorder,
    borderRadius: radius.md,
    padding: space.lg,
  },
  gapsHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  gapsTitle: { ...type.label, color: colors.devInk },
  gap: { fontSize: 13, lineHeight: 20, color: colors.devInk },
  cover: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: radius.md,
    backgroundColor: colors.border,
  },
  card: {
    gap: 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
  },
  name: { fontSize: 17, fontWeight: "700", color: colors.ink },
  venue: { fontSize: 13, color: colors.inkMuted },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowLabel: { fontSize: 13, color: colors.inkMuted },
  rowValueWrap: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  rowValue: { fontSize: 14, fontWeight: "600", color: colors.ink, textAlign: "right" },
  blockLabel: { ...type.label, color: colors.ink },
  blockBody: { fontSize: 13, lineHeight: 19, color: colors.inkMuted },
});
