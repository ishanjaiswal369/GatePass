import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { Text, StyleSheet } from "react-native";
import { spotListingApi } from "@/api";
import { Field, OptionCard, RestoringScreen, WizardShell } from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { useWizardBack } from "@/hooks/useWizardBack";
import { useSession } from "@/providers/SessionProvider";
import { TOTAL_STEPS, nextStepPath, stepNumber } from "@/constants/wizard";
import { colors, space, type } from "@/theme";
import type { SpaceType } from "@/types/api.types";

/**
 * Step 1. What this is, and what it is called.
 *
 * This is the step that creates the listing -- and, for a first-time host,
 * the host profile alongside it. Nothing exists in the database until
 * Continue here, which is the point: the wizard used to open a blank row
 * first and ask for its name on a later screen, so anyone who looked at the
 * wizard and left found a "New spot" on their dashboard they had never
 * chosen to create, indistinguishable from the next one.
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
  const { user, setUser } = useSession();
  const back = useWizardBack("type", spot?.id);

  const [spaceType, setSpaceType] = useState<SpaceType | null>(null);
  const [name, setName] = useState("");

  // Only when editing an existing spot. A new one starts empty, and a `spot`
  // that is null is exactly that -- there is nothing to prefill from.
  useEffect(() => {
    if (!spot) return;
    setSpaceType(spot.spaceType);
    setName(spot.name);
  }, [spot]);

  const { run: save, busy, error } = useAsyncAction(async () => {
    if (!token || !spaceType) return;

    const input = {
      name: name.trim(),
      venueName: spot?.venueName?.trim() || name.trim(),
      spaceType,
    };

    if (spot) {
      await spotListingApi.saveType(token, spot.id, input);
      router.push(nextStepPath("type", spot.id));
      return;
    }

    const created = await spotListingApi.create(token, input);

    // Creating a spot is also what makes a first-time host a host. Every
    // later step decides whether to ask the server for the spot at all from
    // this flag, so it has to move now -- otherwise the next screen believes
    // there is nothing to load.
    if (user && !user.hasHostProfile) {
      setUser({ ...user, hasHostProfile: true });
    }

    router.push(nextStepPath("type", created.id));
  });

  if (isRestoring || loading) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  return (
    <WizardShell
      title="Your space"
      sub="What are you renting out?"
      step={stepNumber("type")}
      totalSteps={TOTAL_STEPS}
      onBack={back}
      onContinue={save}
      canContinue={Boolean(spaceType && name.trim())}
      busy={busy}
      error={error}
      footerNote={
        spot ? undefined : "Nothing is saved until you continue from here."
      }
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
