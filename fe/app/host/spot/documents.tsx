import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { spotListingApi } from "@/api";
import {
  Button,
  Checkbox,
  CheckIcon,
  InfoIcon,
  LockIcon,
  OptionCard,
  RestoringScreen,
  ShieldIcon,
  WizardShell,
} from "@/components/ui";
import { TOTAL_STEPS, firstStepPath, stepNumber } from "@/constants/wizard";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { useWizardBack } from "@/hooks/useWizardBack";
import { useWizardContinue } from "@/hooks/useWizardContinue";
import { pickImages } from "@/lib/pickImages";
import { colors, radius, space, type } from "@/theme";
import type { OwnershipDocType, PermissionBasis, SpotListing } from "@/types/api.types";

/**
 * Step 8. Proof that the space is connected to the address, and the host's
 * permission to rent it.
 *
 * Owning a space and being allowed to rent someone else's are different
 * promises, so they are two choices, not one tick box; a space in a housing
 * society or RWA-managed property also needs that body's permission. The
 * document is private -- its host and GatePass's reviewers only, never a
 * driver -- and is checked by a person before the listing goes live.
 */
const DOC_TYPES: { value: OwnershipDocType; label: string }[] = [
  { value: "ELECTRICITY_BILL", label: "Recent electricity bill" },
  { value: "PROPERTY_TAX", label: "Property tax receipt" },
  { value: "ALLOTMENT_LETTER", label: "Parking allotment document" },
  { value: "OTHER", label: "Other property / address document" },
];

type DocState = "missing" | "attached" | "pending" | "approved" | "failed";

function docState(spot: SpotListing, url: string | null, replaced: boolean): DocState {
  if (!url) return "missing";
  if (spot.status === "REJECTED" && spot.rejectionSection === "documents" && !replaced) return "failed";
  if (spot.docApprovedAt || ["PUBLISHED", "ONGOING", "SUSPENDED"].includes(spot.status)) return "approved";
  if (spot.status === "PENDING_REVIEW") return "pending";
  return "attached";
}

export default function DocumentsScreen() {
  const { spot, loading, isRestoring, token } = useSpotDraft();
  const back = useWizardBack("documents", spot?.id);
  const proceed = useWizardContinue("documents");

  const [docUrl, setDocUrl] = useState<string | null>(null);
  const [replaced, setReplaced] = useState(false);
  const [docType, setDocType] = useState<OwnershipDocType | null>(null);
  const [basis, setBasis] = useState<PermissionBasis | null>(null);
  const [inSociety, setInSociety] = useState<boolean | null>(null);
  const [societyOk, setSocietyOk] = useState(false);

  useEffect(() => {
    if (!spot) return;
    setDocUrl(spot.ownershipDocUrl);
    setDocType(spot.ownershipDocType);
    setBasis(spot.permissionBasis);
    // A society space is in a society; otherwise the host says.
    setInSociety(spot.inSociety ?? (spot.spaceType === "SOCIETY" ? true : null));
    setSocietyOk(Boolean(spot.societyPermissionAt));
  }, [spot]);

  const { run: upload, busy: uploading, error: uploadError } = useAsyncAction(async () => {
    if (!token || !spot) return;

    const picked = await pickImages({ quality: 0.9 });
    if (!picked) return;

    const [image] = picked;
    const presigned = await spotListingApi.presignDocument(token, spot.id, {
      contentType: image.contentType,
      contentLength: image.size,
    });
    const url = await spotListingApi.uploadFile(presigned, image.blob);
    await spotListingApi.saveOwnershipDocument(token, spot.id, url);
    setDocUrl(url);
    setReplaced(true);
  });

  const editable = spot ? spot.status === "DRAFT" || spot.status === "REJECTED" : false;

  const { run: save, busy, error } = useAsyncAction(async () => {
    if (!token || !spot) return;
    if (editable && docType && basis && inSociety !== null) {
      await spotListingApi.savePermission(token, spot.id, {
        ownershipDocType: docType,
        permissionBasis: basis,
        inSociety,
        ...(inSociety && societyOk ? { societyPermission: true as const } : {}),
      });
    }
    proceed(spot);
  });

  if (isRestoring || loading) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;
  if (!spot) return <Redirect href={firstStepPath()} />;

  const state = docState(spot, docUrl, replaced);
  const missing = !editable
    ? null
    : !docType
      ? "Choose the type of document."
      : !docUrl || state === "failed"
        ? "Attach your ownership or permission document."
        : !basis
          ? "Confirm you own the space or have the owner's permission."
          : inSociety === null
            ? "Say whether the space is in a housing society."
            : inSociety && !societyOk
              ? "Confirm your society or RWA's permission."
              : null;

  return (
    <WizardShell
      title="Proof and permission"
      sub="The last checks before review."
      step={stepNumber("documents")}
      totalSteps={TOTAL_STEPS}
      onBack={back}
      onContinue={save}
      canContinue={missing === null && !uploading}
      busy={busy}
      error={error ?? uploadError}
      footerNote={missing ?? (editable ? undefined : "These were checked when your listing was approved.")}
    >
      <View style={s.card}>
        <View style={s.cardHead}>
          <ShieldIcon color={colors.accent} size={18} />
          <Text style={s.cardTitle}>Ownership proof</Text>
        </View>
        <Text style={s.cardBody}>
          We use this to verify that the parking space is connected to the address you provided.
        </Text>

        <View style={s.types} accessibilityRole="radiogroup">
          {DOC_TYPES.map((d) => (
            <OptionCard
              key={d.value}
              label={d.label}
              selected={docType === d.value}
              onPress={() => editable && setDocType(d.value)}
              disabled={!editable}
            />
          ))}
        </View>

        <DocStatus state={state} reason={spot.rejectionReason} />

        {editable ? (
          state === "failed" ? (
            <Button label={uploading ? "Uploading…" : "Fix document"} onPress={upload} busy={uploading} />
          ) : (
            <Pressable
              onPress={upload}
              disabled={uploading}
              accessibilityRole="button"
              style={({ pressed }) => [s.upload, pressed && s.uploadPressed]}
            >
              {docUrl ? (
                <>
                  <CheckIcon color="#166534" size={16} />
                  <Text style={s.uploadDone}>Document attached — tap to replace</Text>
                </>
              ) : (
                <Text style={s.uploadLabel}>{uploading ? "Uploading…" : "Upload document"}</Text>
              )}
            </Pressable>
          )
        ) : null}

        <View style={s.private}>
          <LockIcon color={colors.inkMuted} size={14} />
          <Text style={s.privateText}>Private: only you and GatePass reviewers see it. Drivers never do.</Text>
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>Your permission to rent it</Text>
        <View accessibilityRole="radiogroup" style={s.types}>
          <OptionCard
            label="I confirm I own this space."
            selected={basis === "OWNER"}
            onPress={() => editable && setBasis("OWNER")}
            disabled={!editable}
          />
          <OptionCard
            label="I confirm I have permission from the owner to rent this space."
            selected={basis === "OWNER_PERMISSION"}
            onPress={() => editable && setBasis("OWNER_PERMISSION")}
            disabled={!editable}
          />
        </View>

        <Text style={s.question}>Is the space in a housing society, apartment complex or RWA-managed property?</Text>
        <View style={s.pair} accessibilityRole="radiogroup">
          <View style={s.flex}>
            <OptionCard label="Yes" selected={inSociety === true} onPress={() => editable && setInSociety(true)} disabled={!editable} />
          </View>
          <View style={s.flex}>
            <OptionCard label="No" selected={inSociety === false} onPress={() => editable && setInSociety(false)} disabled={!editable} />
          </View>
        </View>

        {inSociety ? (
          <Checkbox
            label="I confirm I have any required society/RWA permission to rent this space."
            checked={societyOk}
            onChange={(on) => editable && setSocietyOk(on)}
          />
        ) : null}

        <Text style={s.consentNote}>
          You're responsible for having the permissions needed. A complaint from the owner or the society takes the
          listing down.
        </Text>
      </View>
    </WizardShell>
  );
}

/** Where the document stands, in words and a tone. */
function DocStatus({ state, reason }: { state: DocState; reason: string | null }) {
  if (state === "missing" || state === "attached") return null;
  const copy = {
    pending: { title: "Verification pending", body: "We're checking your document.", tone: s.statusPending },
    approved: { title: "Verification approved", body: "Your document has been accepted.", tone: s.statusGood },
    failed: { title: "Verification needs attention", body: reason ?? "We couldn't verify this document.", tone: s.statusBad },
  }[state];
  return (
    <View style={[s.status, copy.tone]} accessibilityLiveRegion="polite">
      <View style={s.statusHead}>
        {state === "approved" ? <CheckIcon color="#166534" size={15} /> : <InfoIcon color={colors.ink} size={15} />}
        <Text style={s.statusTitle}>{copy.title}</Text>
      </View>
      <Text style={s.statusBody}>{copy.body}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    gap: space.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  cardTitle: { ...type.label, color: colors.ink, fontSize: 15 },
  cardBody: { fontSize: 13, lineHeight: 19, color: colors.inkMuted },
  types: { gap: space.sm },
  question: { fontSize: 14, lineHeight: 20, color: colors.ink, fontWeight: "600" },
  pair: { flexDirection: "row", gap: space.md },
  upload: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    minHeight: 48,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.borderStrong,
    backgroundColor: colors.canvas,
  },
  uploadPressed: { backgroundColor: colors.border },
  uploadLabel: { fontSize: 14, fontWeight: "600", color: colors.ink },
  uploadDone: { fontSize: 13, color: colors.inkMuted },
  private: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  privateText: { flex: 1, ...type.caption, color: colors.inkMuted, lineHeight: 17 },
  status: { borderRadius: radius.sm, padding: space.md, gap: 2 },
  statusHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  statusTitle: { fontSize: 14, fontWeight: "700", color: colors.ink },
  statusBody: { fontSize: 13, lineHeight: 18, color: colors.inkMuted },
  statusPending: { backgroundColor: colors.accentSurface },
  statusGood: { backgroundColor: "#dcfce7" },
  statusBad: { backgroundColor: colors.dangerSurface },
  consentNote: { ...type.caption, color: colors.inkFaint, lineHeight: 17 },
});
