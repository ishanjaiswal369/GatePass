import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { Text, StyleSheet } from "react-native";
import { spotListingApi } from "@/api";
import { Field, OptionCard, RestoringScreen, WizardShell } from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { TOTAL_STEPS, nextStepPath, stepNumber } from "@/constants/wizard";
import { colors, space, type } from "@/theme";
import type { SpaceType } from "@/types/api.types";

/**
 * Step 1. What kind of space this is.
 *
 * On-street parking is absent by design, not by omission: a host cannot
 * promise exclusive use of public kerbside, so letting them list one would
 * sell a driver something the host does not control.
 */
const SPACE_TYPES: {
  value: SpaceType;
  label: string;
  description: string;
}[] = [
  {
    value: "DRIVEWAY",
    label: "Driveway",
    description: "Open space beside or in front of your home.",
  },
  {
    value: "GARAGE",
    label: "Garage",
    description: "Enclosed and lockable, in your building or home.",
  },
  {
    value: "CAR_PARK",
    label: "Car park bay",
    description: "An allotted bay in a society or commercial car park.",
  },
];

export default function SpaceTypeScreen() {
  const { spot, loading, isRestoring, token } = useSpotDraft();

  const [spaceType, setSpaceType] = useState<SpaceType | null>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    if (!spot) return;
    setSpaceType(spot.spaceType);
    // The name onboarding generated ("Parking at 12 Lane") is a placeholder;
    // showing it prefilled lets the host keep or replace it rather than
    // wonder where the one in search came from.
    setName(spot.name);
  }, [spot]);

  const { run: save, busy, error } = useAsyncAction(async () => {
    if (!token || !spot || !spaceType) return;

    await spotListingApi.saveType(token, spot.id, {
      name: name.trim(),
      venueName: spot.venueName?.trim() || name.trim(),
      spaceType,
    });

    router.push(nextStepPath("type", spot.id));
  });

  if (isRestoring || loading) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;
  // No id in the URL, or a stale one: there is no draft to name yet. The
  // dashboard is what opens a blank one (host.tsx's "Add another spot"), or
  // the address step does for a brand-new host.
  if (!spot) return <Redirect href="/host/spot" />;

  return (
    <WizardShell
      title="Your space"
      sub="What are you renting out?"
      step={stepNumber("type")}
      totalSteps={TOTAL_STEPS}
      onBack={() => router.back()}
      onContinue={save}
      canContinue={Boolean(spaceType && name.trim())}
      busy={busy}
      error={error}
    >
      {SPACE_TYPES.map((option) => (
        <OptionCard
          key={option.value}
          label={option.label}
          description={option.description}
          selected={spaceType === option.value}
          onPress={() => setSpaceType(option.value)}
        />
      ))}

      <Text style={s.note}>
        On-street parking cannot be listed — a space has to be one you control.
      </Text>

      <Field
        label="Name this listing"
        hint="Drivers see this in search. Something like “Covered garage near Kothrud bus stop”."
        value={name}
        onChangeText={setName}
        maxLength={120}
      />
    </WizardShell>
  );
}

const s = StyleSheet.create({
  note: { ...type.caption, color: colors.inkFaint, lineHeight: 18 },
});
