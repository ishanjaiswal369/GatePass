import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { spotListingApi } from "@/api";
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
  StatusChip,
} from "@/components/ui";
import { WIZARD_STEPS, firstStepPath, isWizardStep, stepHref, type WizardStep } from "@/constants/wizard";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { groupByHours } from "@/lib/hours";
import { listingStatus } from "@/lib/listingRules";
import { rateLine } from "@/lib/money";
import { colors, radius, space, type } from "@/theme";
import type { SpotListing } from "@/types/api.types";

const SECTION_TITLES: Partial<Record<WizardStep, string>> = {
  type: "Your space",
  address: "Address",
  photos: "Photos",
  details: "Parking details",
  availability: "Availability",
  pricing: "Pricing",
  access: "Getting in",
  documents: "Proof & permission",
  payout: "Getting paid",
};

/**
 * Where a listing stands, once it's more than a draft.
 *
 * A draft doesn't stop here: it resumes at the first step that still needs
 * something (from the API's readiness list), not at step 1 -- a host who
 * finished six steps last week shouldn't page through them again. What is
 * left is what the wizard can't show: what happened after Submit (under
 * review, approved and waiting on payout, live), a rejection with its reason
 * and the step to fix, and what was submitted.
 */
export default function SpotStatusScreen() {
  const { spot, loading, error, isRestoring, token } = useSpotDraft();
  const { submitted } = useLocalSearchParams<{ submitted?: string }>();
  const [resume, setResume] = useState<string | null>(null);

  // A draft: find the first step with something missing.
  useEffect(() => {
    if (!token || !spot || spot.status !== "DRAFT") return;
    spotListingApi
      .readiness(token, spot.id)
      .then(({ items }) => {
        const steps = items.map((i) => i.step).filter(isWizardStep);
        const first = WIZARD_STEPS.find((step) => steps.includes(step)) ?? "review";
        setResume(stepHref(first, spot.id));
      })
      .catch(() => setResume(firstStepPath(spot.id)));
  }, [token, spot]);

  if (isRestoring || loading) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  // No spot yet: the first step creates one.
  if (!error && !spot) return <Redirect href={firstStepPath()} />;
  if (spot?.status === "DRAFT") return resume ? <Redirect href={resume} /> : <RestoringScreen />;

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <SectionHeader title="Your listing" sub={spot?.name} onBack={() => router.replace("/host")} />

        <ScrollView contentContainerStyle={s.body}>
          {error ? <ErrorNotice message={error} /> : null}

          {!spot ? (
            <ActivityIndicator color={colors.ink} style={s.loader} />
          ) : (
            <>
              <StatusCard spot={spot} justSubmitted={submitted === "1"} />
              <SpotSummary spot={spot} />
            </>
          )}

          {/* Always: this is where the wizard ends, and the Host tab is the
              only place left to go from it. */}
          <Button label="Back to your spaces" variant="ghost" onPress={() => router.replace("/host")} />
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
function StatusCard({ spot, justSubmitted }: { spot: SpotListing; justSubmitted: boolean }) {
  const chip = listingStatus(spot);

  if (spot.status === "REJECTED") {
    const section = isWizardStep(spot.rejectionSection) ? spot.rejectionSection : null;
    return (
      <View style={[s.status, s.statusBad]}>
        <View style={s.statusHead}>
          <InfoIcon color="#b91c1c" size={16} />
          <Text style={[s.statusTitle, s.bad]}>Your listing needs changes</Text>
        </View>
        <StatusChip label="REJECTED" tone="danger" />
        <Text style={s.statusBody}>{spot.rejectionReason ?? "Update the listing and submit it again."}</Text>
        {section ? <DataRow label="Section" value={SECTION_TITLES[section] ?? section} /> : null}
        <Button
          label={section === "documents" ? "Replace document" : section ? `Fix ${SECTION_TITLES[section]?.toLowerCase()}` : "Edit listing"}
          onPress={() => router.push(stepHref(section ?? "type", spot.id))}
        />
        <Button label="Review and resubmit" variant="ghost" onPress={() => router.push(stepHref("review", spot.id))} />
      </View>
    );
  }

  if (spot.status === "PENDING_REVIEW") {
    const approved = Boolean(spot.docApprovedAt);
    return (
      <View style={[s.status, approved && s.statusGood]}>
        <View style={s.statusHead}>
          {justSubmitted || approved ? <CheckIcon color="#166534" size={16} /> : <ClockIcon color={colors.inkMuted} size={16} />}
          <Text style={s.statusTitle}>
            {approved ? "Listing approved" : justSubmitted ? "Listing submitted" : "Your listing is being reviewed"}
          </Text>
        </View>
        <StatusChip label={approved ? "APPROVED" : "UNDER REVIEW"} tone={chip.tone} />
        <Text style={s.statusBody}>
          {approved
            ? "Your document has been approved. Your listing goes live as soon as your payout account is active."
            : justSubmitted
              ? "Your parking space has been submitted for verification. We'll review your information and notify you when your listing is approved."
              : "We'll review your information and notify you when your listing is approved."}
        </Text>
        <Step done={approved} text="We check the ownership proof you attached." />
        <Step done={false} text="Your payout account is verified, so you can be paid." />
      </View>
    );
  }

  const live = spot.status === "PUBLISHED" || spot.status === "ONGOING";
  return (
    <View style={[s.status, live && s.statusGood, spot.status === "SUSPENDED" && s.statusBad]}>
      <View style={s.statusHead}>
        {live ? <CheckIcon color="#166534" size={16} /> : <InfoIcon color={colors.ink} size={16} />}
        <Text style={s.statusTitle}>{live ? "Your listing is live" : spot.status === "SUSPENDED" ? "Your listing is suspended" : "This listing was removed"}</Text>
      </View>
      <StatusChip label={chip.label.toUpperCase()} tone={chip.tone} />
      <Text style={s.statusBody}>
        {live
          ? "Drivers nearby can find and book it during the hours you set."
          : spot.status === "SUSPENDED"
            ? spot.rejectionReason ?? "It's offline for now. Contact support to put it back online."
            : "It no longer appears in search. Add a new space from the Host tab to start again."}
      </Text>
      {live ? <Button label="Manage listing" onPress={() => router.replace({ pathname: "/host/listing/[id]", params: { id: spot.id } })} /> : null}
    </View>
  );
}

function Step({ done, text }: { done: boolean; text: string }) {
  return (
    <View style={s.step}>
      {done ? <CheckIcon color="#166534" size={14} /> : <View style={s.stepDot} />}
      <Text style={s.stepText}>{text}</Text>
    </View>
  );
}

/** What was sent, so the host can check it without reopening ten steps. */
function SpotSummary({ spot }: { spot: SpotListing }) {
  const hours = groupByHours(spot.availability.filter((window) => window.isActive));

  return (
    <View style={s.card}>
      {spot.photos.length > 0 ? <Image source={{ uri: spot.photos[0].url }} style={s.cover} resizeMode="cover" /> : null}

      <Text style={s.cardHeading}>What you submitted</Text>

      {spot.addressLine ? (
        <DataRow label="Address" value={[spot.addressLine, spot.area, spot.city, spot.pincode].filter(Boolean).join(", ")} />
      ) : null}

      {spot.pricing.map((rate) => (
        <DataRow key={rate.id} label={rate.vehicleType === "BIKE" ? "Bikes" : "Cars"} value={rateLine(rate)} />
      ))}

      <DataRow label="Photos" value={`${spot.photos.length}`} />

      {hours.map((row) => (
        <DataRow key={row.label} label={row.label} value={row.hours} />
      ))}
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
  statusGood: { borderColor: "#86efac", backgroundColor: "#f0fdf4" },
  statusBad: { borderColor: "#fecaca", backgroundColor: colors.dangerSurface },
  statusHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  statusTitle: { fontSize: 16, fontWeight: "700", color: colors.ink },
  bad: { color: "#b91c1c" },
  statusBody: { fontSize: 13, lineHeight: 20, color: colors.inkMuted },
  step: { flexDirection: "row", gap: space.md, alignItems: "center" },
  stepDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent, marginHorizontal: 4 },
  stepText: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.inkMuted },
  card: {
    gap: space.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
  },
  cover: { width: "100%", aspectRatio: 16 / 9, borderRadius: radius.sm, backgroundColor: colors.border, marginBottom: space.xs },
  cardHeading: { ...type.label, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: 0.6 },
});
