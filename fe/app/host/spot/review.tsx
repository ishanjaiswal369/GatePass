import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { spotListingApi } from "@/api";
import {
  Button,
  CheckIcon,
  ChevronRightIcon,
  InfoIcon,
  RestoringScreen,
  StatusChip,
  WizardShell,
} from "@/components/ui";
import { TOTAL_STEPS, firstStepPath, isWizardStep, stepHref, stepNumber, type WizardStep } from "@/constants/wizard";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { useWizardBack } from "@/hooks/useWizardBack";
import { groupByHours } from "@/lib/hours";
import { listingStatus, vehicleTypesOf } from "@/lib/listingRules";
import { rateLine } from "@/lib/money";
import { AMENITY_LABELS, ENTRY_METHOD_LABELS, VEHICLE_SIZE_LABELS, spaceLabel } from "@/lib/spotLabels";
import { colors, radius, space, type } from "@/theme";
import type { PayoutAccount, SpotListing, SpotReadiness } from "@/types/api.types";

/**
 * Step 10. The listing as it will read, and what's still missing.
 *
 * Each section has Edit, which opens its step with everything kept. What is
 * missing comes from the API -- the same check Submit runs -- as items that
 * each name their step, so a tap goes straight to the fix. Submitting sends
 * the listing to review; it goes live only when the document is approved and
 * the payout account is active.
 */
const SECTION_TITLES: Record<string, string> = {
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

export default function ReviewScreen() {
  const { spot, setSpot, loading, isRestoring, token, reload } = useSpotDraft();
  const back = useWizardBack("review", spot?.id);
  const id = spot?.id;

  const [readiness, setReadiness] = useState<SpotReadiness | null>(null);
  const [payout, setPayout] = useState<PayoutAccount | null>(null);

  // On focus, not mount: back from fixing something (Edit → a step → Back),
  // the preview and the list have to reflect it. Refreshed in place, so the
  // screen doesn't flash a loader every time.
  useFocusEffect(
    useCallback(() => {
      if (!token || !id) return;
      void Promise.all([
        spotListingApi.getById(token, id).then(setSpot),
        spotListingApi.readiness(token, id).then(setReadiness),
        spotListingApi.getPayoutAccount(token).then(setPayout, () => setPayout(null)),
      ]).catch(() => undefined);
    }, [token, id, setSpot])
  );

  const { run: submit, busy, error } = useAsyncAction(async () => {
    if (!token || !spot) return;
    await spotListingApi.submit(token, spot.id);
    await reload();
    router.replace({ pathname: "/host/spot", params: { id: spot.id, submitted: "1" } });
  });

  if (isRestoring || loading) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;
  if (!spot) return <Redirect href={firstStepPath()} />;

  const items = readiness?.items ?? [];
  const ready = readiness?.ready === true;
  const edit = (step: WizardStep) => router.push(stepHref(step, spot.id, "review"));

  return (
    <WizardShell
      title="Review"
      sub="Check it over, then submit it for review."
      step={stepNumber("review")}
      totalSteps={TOTAL_STEPS}
      onBack={back}
      onContinue={submit}
      canContinue={ready}
      continueLabel="Submit for review"
      busy={busy}
      error={error}
      footerNote={
        readiness === null
          ? "Checking your listing…"
          : ready
            ? "We check your document; your listing goes live once your payout account is active too."
            : "Complete the items above to submit."
      }
    >
      {spot.status === "REJECTED" ? <Rejected spot={spot} /> : null}

      {items.length > 0 ? (
        <View style={s.gaps}>
          <View style={s.gapsHead}>
            <InfoIcon color={colors.devInk} size={16} />
            <Text style={s.gapsTitle}>Complete these before submitting:</Text>
          </View>
          {items.map((item) => (
            <Pressable
              key={`${item.step}:${item.message}`}
              onPress={() => isWizardStep(item.step) && edit(item.step)}
              accessibilityRole="link"
              accessibilityHint={`Opens ${SECTION_TITLES[item.step] ?? "the step"}`}
              style={({ pressed }) => [s.gap, pressed && s.pressed]}
            >
              <Text style={s.gapText}>• {item.message}</Text>
              <ChevronRightIcon color={colors.devInk} size={16} />
            </Pressable>
          ))}
        </View>
      ) : null}

      <Preview spot={spot} />

      <Section title="Your space" onEdit={() => edit("type")}>
        <Line text={spaceLabel(spot.spaceType)} />
        {spot.description ? <Line text={spot.description} muted /> : null}
      </Section>

      <Section title="Address" onEdit={() => edit("address")}>
        <Line text={[spot.addressLine, spot.area, spot.city, spot.pincode].filter(Boolean).join(", ") || "Not set"} />
        <Status ok={Boolean(spot.pinConfirmedAt)} text={spot.pinConfirmedAt ? "Exact pin placed" : "Pin not placed yet"} />
      </Section>

      <Section title="Photos" onEdit={() => edit("photos")}>
        <Status ok={spot.photos.length >= 2} text={`${spot.photos.length} ${spot.photos.length === 1 ? "photo" : "photos"}`} />
      </Section>

      <Section title="Parking details" onEdit={() => edit("details")}>
        <Line text={`${spot.amenities.includes("COVERED") ? "Covered" : "Open"} · ${vehicleSummary(spot)}`} />
        {spot.amenities.filter((a) => a !== "COVERED").length || spot.amenityNote ? (
          <View style={s.amenities}>
            {spot.amenities
              .filter((a) => a !== "COVERED")
              .map((a) => (
                <Status key={a} ok text={AMENITY_LABELS[a]} />
              ))}
            {spot.amenityNote ? <Status ok text={spot.amenityNote} /> : null}
          </View>
        ) : null}
      </Section>

      <Section title="Availability" onEdit={() => edit("availability")}>
        {groupByHours(spot.availability.filter((w) => w.isActive)).map((row) => (
          <Line key={row.label} text={`${row.label} · ${row.hours}`} />
        ))}
        {spot.availability.length === 0 ? <Line text="Not set" /> : null}
      </Section>

      <Section title="Pricing" onEdit={() => edit("pricing")}>
        {spot.pricing.length > 0 ? (
          spot.pricing.map((row) => <Line key={row.id} text={`${row.vehicleType === "BIKE" ? "Bikes" : "Cars"}: ${rateLine(row)}`} />)
        ) : (
          <Line text="Not set" />
        )}
      </Section>

      <Section title="Getting in" onEdit={() => edit("access")}>
        <Line text={spot.entryMethod ? ENTRY_METHOD_LABELS[spot.entryMethod] : "Entry method not set"} />
        <Status ok={Boolean(spot.accessInstructions)} text={spot.accessInstructions ? "Access instructions added" : "Access instructions missing"} />
      </Section>

      <Section title="Proof & permission" onEdit={() => edit("documents")}>
        <Status ok={Boolean(spot.ownershipDocUrl)} text={`Ownership proof: ${spot.ownershipDocUrl ? "Attached" : "Missing"}`} />
        <Status
          ok={Boolean(spot.permissionBasis)}
          text={
            spot.permissionBasis === "OWNER"
              ? "You own the space"
              : spot.permissionBasis === "OWNER_PERMISSION"
                ? "The owner has given permission"
                : "Permission not confirmed"
          }
        />
      </Section>

      <Section title="Getting paid" onEdit={() => edit("payout")}>
        <Status ok={payoutOk(payout)} text={`Payout: ${payoutLabel(payout)}`} />
      </Section>
    </WizardShell>
  );
}

/** The card a driver will see: cover, name, place, headline prices. */
function Preview({ spot }: { spot: SpotListing }) {
  const status = listingStatus(spot);
  return (
    <View style={s.preview}>
      {spot.photos[0] ? (
        <Image source={{ uri: spot.photos[0].url }} style={s.cover} resizeMode="cover" accessibilityLabel="Cover photo" />
      ) : (
        <View style={[s.cover, s.coverEmpty]}>
          <Text style={s.muted}>No cover photo yet</Text>
        </View>
      )}
      <View style={s.previewBody}>
        <View style={s.previewHead}>
          <Text style={s.name}>{spot.name}</Text>
          <StatusChip label={status.label} tone={status.tone} />
        </View>
        <Text style={s.muted}>
          {[spot.area, spot.city].filter(Boolean).join(", ") || "Location not set"} · {spaceLabel(spot.spaceType)}
        </Text>
        {spot.pricing.map((row) => (
          <Text key={row.id} style={s.price}>
            {spot.pricing.length > 1 ? `${row.vehicleType === "BIKE" ? "Bikes" : "Cars"}: ` : ""}
            {rateLine(row)}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** A rejection: why, where, and the button that goes there. */
function Rejected({ spot }: { spot: SpotListing }) {
  const section = isWizardStep(spot.rejectionSection) ? spot.rejectionSection : null;
  return (
    <View style={s.rejected} accessibilityLiveRegion="polite">
      <Text style={s.rejectedTitle}>Your listing needs changes</Text>
      <Text style={s.rejectedBody}>{spot.rejectionReason ?? "Update the listing and submit it again."}</Text>
      {section ? (
        <>
          <Text style={s.rejectedBody}>Section: {SECTION_TITLES[section]}</Text>
          <Button
            label={section === "documents" ? "Replace document" : `Fix ${SECTION_TITLES[section].toLowerCase()}`}
            onPress={() => router.push(stepHref(section, spot.id, "review"))}
          />
        </>
      ) : null}
    </View>
  );
}

function Section({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <View style={s.sectionHead}>
        <Text style={s.sectionTitle} accessibilityRole="header">
          {title}
        </Text>
        <Pressable onPress={onEdit} accessibilityRole="link" accessibilityLabel={`Edit ${title}`} hitSlop={10} style={s.editLink}>
          <Text style={s.edit}>Edit</Text>
          <ChevronRightIcon color={colors.ink} size={14} />
        </Pressable>
      </View>
      {children}
    </View>
  );
}

function Line({ text, muted }: { text: string; muted?: boolean }) {
  return <Text style={muted ? s.lineMuted : s.line}>{text}</Text>;
}

function Status({ ok, text }: { ok: boolean; text: string }) {
  return (
    <View style={s.status}>
      {ok ? <CheckIcon color="#166534" size={14} /> : <InfoIcon color={colors.accentInk} size={14} />}
      <Text style={[s.line, !ok && s.warn]}>{text}</Text>
    </View>
  );
}

function vehicleSummary(spot: SpotListing): string {
  const types = vehicleTypesOf(spot);
  if (types.length === 0) return "Vehicles not set";
  return [
    types.includes("CAR") ? (spot.maxVehicleSize ? VEHICLE_SIZE_LABELS[spot.maxVehicleSize] : "Cars") : null,
    types.includes("BIKE") ? "Bikes" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function payoutOk(account: PayoutAccount | null): boolean {
  return account?.payoutKycStatus === "ACTIVATED" || (!!account && !account.needsDetails && account.payoutKycStatus !== "REJECTED");
}

function payoutLabel(account: PayoutAccount | null): string {
  if (!account || account.needsDetails) return "Not configured";
  if (account.payoutKycStatus === "ACTIVATED") return "Active";
  if (account.payoutKycStatus === "REJECTED") return "Needs attention";
  return "Verification pending";
}

const s = StyleSheet.create({
  gaps: {
    gap: 2,
    backgroundColor: colors.devSurface,
    borderWidth: 1,
    borderColor: colors.devBorder,
    borderRadius: radius.md,
    padding: space.lg,
  },
  gapsHead: { flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.xs },
  gapsTitle: { ...type.label, color: colors.devInk },
  gap: { flexDirection: "row", alignItems: "center", minHeight: 40, gap: space.sm },
  gapText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.devInk },
  pressed: { opacity: 0.7 },
  preview: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: "hidden" },
  cover: { width: "100%", aspectRatio: 16 / 9, backgroundColor: colors.border },
  coverEmpty: { alignItems: "center", justifyContent: "center" },
  previewBody: { padding: space.lg, gap: 4 },
  previewHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space.sm },
  name: { flex: 1, fontSize: 17, fontWeight: "700", color: colors.ink },
  muted: { fontSize: 13, color: colors.inkMuted },
  price: { fontSize: 14, fontWeight: "700", color: colors.ink },
  rejected: { backgroundColor: colors.dangerSurface, borderRadius: radius.md, padding: space.lg, gap: space.sm },
  rejectedTitle: { fontSize: 15, fontWeight: "700", color: "#b91c1c" },
  rejectedBody: { fontSize: 13, lineHeight: 19, color: "#b91c1c" },
  section: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: space.md, gap: 6 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 36 },
  sectionTitle: { ...type.label, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: 0.6 },
  editLink: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 36 },
  edit: { fontSize: 14, fontWeight: "600", color: colors.ink },
  line: { fontSize: 14, lineHeight: 20, color: colors.ink, flexShrink: 1 },
  lineMuted: { fontSize: 13, lineHeight: 19, color: colors.inkMuted },
  warn: { color: colors.accentInk, fontWeight: "600" },
  status: { flexDirection: "row", alignItems: "center", gap: 6 },
  amenities: { gap: 4 },
});
