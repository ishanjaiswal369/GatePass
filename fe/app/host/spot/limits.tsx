import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { spotListingApi } from "@/api";
import { Field, RestoringScreen, WizardShell } from "@/components/ui";
import { VEHICLE_SIZES, type VehicleSize } from "@/constants/enums";
import { TOTAL_STEPS, firstStepPath, stepNumber } from "@/constants/wizard";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { useWizardBack } from "@/hooks/useWizardBack";
import { VEHICLE_SIZE_LABELS } from "@/lib/spotLabels";
import { continueAfter } from "@/lib/wizardFlow";
import { colors, radius, space, type } from "@/theme";

/** Feet and inches from centimetres, to one decimal of a foot: "7 ft (2.1 m)". */
function feetLabel(cm: number): string {
  return `${(cm / 30.48).toFixed(1).replace(/\.0$/, "")} ft (${(cm / 100).toFixed(1)} m)`;
}

/**
 * Any vehicle limits? Stops a driver arriving with something that won't fit.
 *
 * All optional. Height in centimetres because that's what a tape measure
 * gives; shown back in feet and metres, which is how drivers think of it.
 * The rules are public and short -- "No commercial vehicles" -- not a place
 * for the access instructions, which stay private until payment.
 */
export default function LimitsScreen() {
  const { spot, loading, isRestoring, token } = useSpotDraft();
  const back = useWizardBack("limits", spot?.id);
  const [height, setHeight] = useState("");
  const [size, setSize] = useState<VehicleSize | null>(null);
  const [rules, setRules] = useState("");

  useEffect(() => {
    if (!spot) return;
    setHeight(spot.maxVehicleHeightCm ? String(spot.maxVehicleHeightCm) : "");
    setSize(spot.maxVehicleSize ?? null);
    setRules(spot.rules ?? "");
  }, [spot]);

  const cm = height ? Number(height) : null;
  const heightOk = cm === null || (Number.isInteger(cm) && cm >= 100 && cm <= 500);

  const { run: save, busy, error } = useAsyncAction(async () => {
    if (!token || !spot) return;
    await spotListingApi.saveLimits(token, spot.id, {
      maxVehicleHeightCm: cm,
      maxVehicleSize: size,
      rules: rules.trim() || null,
    });
    continueAfter("limits", spot);
  });

  if (isRestoring || loading) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;
  if (!spot) return <Redirect href={firstStepPath()} />;

  return (
    <WizardShell
      title="Any vehicle limits?"
      sub="Stops a driver arriving with something that won't fit."
      step={stepNumber("limits")}
      totalSteps={TOTAL_STEPS}
      onBack={back}
      onContinue={save}
      canContinue={heightOk}
      busy={busy}
      error={error}
      footerNote={heightOk ? undefined : "Height should be between 100 and 500 cm."}
    >
      <Field
        label="Maximum height (cm)"
        optional
        value={height}
        onChangeText={(t) => setHeight(t.replace(/[^0-9]/g, "").slice(0, 3))}
        keyboardType="number-pad"
        placeholder="210"
        hint={cm && heightOk ? feetLabel(cm) : "Leave blank if there's no roof or barrier."}
      />

      <View style={s.group}>
        <Text style={s.label}>Largest vehicle that fits</Text>
        <View style={s.chips} accessibilityRole="radiogroup">
          {VEHICLE_SIZES.map((option) => {
            const on = size === option;
            return (
              <Pressable
                key={option}
                onPress={() => setSize(on ? null : option)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                style={[s.chip, on && s.chipOn]}
              >
                <Text style={[s.chipText, on && s.chipTextOn]}>{VEHICLE_SIZE_LABELS[option]}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Field
        label="Other rules"
        optional
        value={rules}
        onChangeText={setRules}
        placeholder="No commercial vehicles. Please don't wash cars here."
        multiline
        maxLength={300}
        style={s.rules}
        hint={`Shown to drivers before they book · ${rules.length}/300`}
      />
    </WizardShell>
  );
}

const s = StyleSheet.create({
  group: { gap: space.sm },
  label: { ...type.label, color: colors.ink },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontSize: 14, fontWeight: "600", color: colors.ink },
  chipTextOn: { color: colors.onInk },
  rules: { minHeight: 80 },
});
