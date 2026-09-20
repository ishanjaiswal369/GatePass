import { Redirect, router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { spotListingApi } from "@/api";
import {
  Checkbox,
  CheckIcon,
  RestoringScreen,
  ShieldIcon,
  WizardShell,
} from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { TOTAL_STEPS, nextStepPath, stepNumber } from "@/constants/wizard";
import { colors, radius, space, type } from "@/theme";

/**
 * Step 7. Proof the host may rent the space out, and their warranty that they
 * may.
 *
 * Both on one screen because they are the same promise made twice -- once as
 * a document a human checks, once as a statement the host is accountable for.
 * Splitting them invites treating the tick box as paperwork.
 */
export default function DocumentsScreen() {
  const { spot, loading, isRestoring, token } = useSpotDraft();

  const [docUrl, setDocUrl] = useState<string | null>(null);
  const [warranty, setWarranty] = useState(false);

  useEffect(() => {
    if (!spot) return;
    setDocUrl(spot.ownershipDocUrl);
    setWarranty(Boolean(spot.warrantyAcceptedAt));
  }, [spot]);

  const { run: upload, busy: uploading, error: uploadError } = useAsyncAction(
    async () => {
      if (!token || !spot) return;

      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
      });

      if (picked.canceled) return;

      const blob = await (await fetch(picked.assets[0].uri)).blob();

      const presigned = await spotListingApi.presignDocument(token, spot.id, {
        contentType: blob.type || "image/jpeg",
        contentLength: blob.size,
      });

      const url = await spotListingApi.uploadFile(presigned, blob);
      await spotListingApi.saveOwnershipDocument(token, spot.id, url);
      setDocUrl(url);
    }
  );

  const { run: save, busy, error } = useAsyncAction(async () => {
    if (!token || !spot) return;

    // Only sent when ticked. The server records consent as a timestamp and
    // never moves it back, so un-ticking is a client-side correction before
    // submitting, not an erasure of something already given.
    await spotListingApi.saveTerms(token, spot.id, { warrantyAccepted: true });
    router.push(nextStepPath("documents"));
  });

  if (isRestoring || loading) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;
  if (!spot) return <Redirect href="/host/spot" />;

  return (
    <WizardShell
      title="Proof and permission"
      sub="The last checks before review."
      step={stepNumber("documents")}
      totalSteps={TOTAL_STEPS}
      onBack={() => router.back()}
      onContinue={save}
      canContinue={Boolean(docUrl && warranty)}
      busy={busy}
      error={error ?? uploadError}
      footerNote={
        docUrl && warranty
          ? undefined
          : "Both the document and the confirmation are needed."
      }
    >
      <View style={s.card}>
        <View style={s.cardHead}>
          <ShieldIcon color={colors.accent} size={18} />
          <Text style={s.cardTitle}>Ownership proof</Text>
        </View>

        <Text style={s.cardBody}>
          A recent electricity bill or property tax receipt showing the address.
          We check the address on it against the one you entered.
        </Text>

        <Pressable
          onPress={upload}
          disabled={uploading}
          accessibilityRole="button"
          style={({ pressed }) => [s.upload, pressed && s.uploadPressed]}
        >
          {docUrl ? (
            <>
              <CheckIcon color={colors.success} size={16} />
              <Text style={s.uploadDone}>Document attached — tap to replace</Text>
            </>
          ) : (
            <Text style={s.uploadLabel}>
              {uploading ? "Uploading…" : "Upload document"}
            </Text>
          )}
        </Pressable>
      </View>

      <View style={s.card}>
        <Checkbox
          label="I confirm I own this space, or have permission from the owner and my society or RWA to rent it out."
          checked={warranty}
          onChange={setWarranty}
        >
          <Text style={s.consentNote}>
            You stay responsible for this being true. A complaint from an owner
            or society takes the listing down.
          </Text>
        </Checkbox>
      </View>
    </WizardShell>
  );
}

const s = StyleSheet.create({
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
  consentNote: { ...type.caption, color: colors.inkFaint, lineHeight: 17 },
});
