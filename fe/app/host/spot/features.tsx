import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { spotListingApi } from "@/api";
import { Checkbox, RestoringScreen, WizardShell } from "@/components/ui";
import { AMENITIES, type Amenity } from "@/constants/enums";
import { TOTAL_STEPS, firstStepPath, stepNumber } from "@/constants/wizard";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { useWizardBack } from "@/hooks/useWizardBack";
import { AMENITY_LABELS } from "@/lib/spotLabels";
import { continueAfter } from "@/lib/wizardFlow";
import { colors, type } from "@/theme";

/**
 * What the space offers.
 *
 * Only what is always true: drivers filter on these, and one who filtered for
 * CCTV and found none leaves a review about it. "24/7 access" isn't here --
 * it's worked out from the opening hours, so it can never contradict them.
 * Nothing is required; a plain driveway is a fine listing.
 */
export default function FeaturesScreen() {
  const { spot, loading, isRestoring, token } = useSpotDraft();
  const back = useWizardBack("features", spot?.id);
  const [picked, setPicked] = useState<Amenity[]>([]);

  useEffect(() => {
    if (spot) setPicked(spot.amenities ?? []);
  }, [spot]);

  const { run: save, busy, error } = useAsyncAction(async () => {
    if (!token || !spot) return;
    await spotListingApi.saveFeatures(token, spot.id, picked);
    continueAfter("features", spot);
  });

  if (isRestoring || loading) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;
  if (!spot) return <Redirect href={firstStepPath()} />;

  const toggle = (amenity: Amenity, on: boolean) =>
    setPicked((current) => (on ? [...current, amenity] : current.filter((a) => a !== amenity)));

  return (
    <WizardShell
      title="What does the space offer?"
      sub="Only tick what's always true — drivers filter on these."
      step={stepNumber("features")}
      totalSteps={TOTAL_STEPS}
      onBack={back}
      onContinue={save}
      busy={busy}
      error={error}
    >
      {AMENITIES.map((amenity) => (
        <Checkbox
          key={amenity}
          label={AMENITY_LABELS[amenity]}
          checked={picked.includes(amenity)}
          onChange={(on) => toggle(amenity, on)}
        />
      ))}
      <Text style={s.note}>24/7 access is shown automatically when your hours cover every day, all day.</Text>
    </WizardShell>
  );
}

const s = StyleSheet.create({
  note: { ...type.caption, color: colors.inkFaint, lineHeight: 18 },
});
