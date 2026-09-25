import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { Text, StyleSheet } from "react-native";
import { spotListingApi } from "@/api";
import { Field, OptionCard, RestoringScreen, WizardShell } from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { useWizardBack } from "@/hooks/useWizardBack";
import { useWizardContinue } from "@/hooks/useWizardContinue";
import { useSession } from "@/providers/SessionProvider";
import { TOTAL_STEPS, nextStepPath, stepNumber } from "@/constants/wizard";
import { NAME_EXAMPLE, nameProblem } from "@/lib/listingRules";
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
  {
    value: "PRIVATE_LOT",
    label: "Private parking lot",
    description: "A privately managed parking area.",
  },
  {
    value: "SOCIETY",
    label: "Apartment / Society parking",
    description: "A parking space inside a residential society.",
  },
  {
    value: "COMMERCIAL",
    label: "Commercial parking",
    description: "A parking space in a commercial property.",
  },
];

export default function SpaceTypeScreen() {
  const { spot, loading, isRestoring, token } = useSpotDraft();
  const { user, setUser } = useSession();
  const back = useWizardBack("type", spot?.id);
  const proceed = useWizardContinue("type");

  const [spaceType, setSpaceType] = useState<SpaceType | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Only when editing an existing spot. A new one starts empty, and a `spot`
  // that is null is exactly that -- there is nothing to prefill from.
  useEffect(() => {
    if (!spot) return;
    // OTHER is only on older listings; asking again is better than keeping it.
    setSpaceType(spot.spaceType === "OTHER" ? null : spot.spaceType);
    setName(spot.name);
    setDescription(spot.description ?? "");
  }, [spot]);

  const { run: save, busy, error } = useAsyncAction(async () => {
    if (!token || !spaceType) return;

    const input = {
      name: name.trim(),
      venueName: spot?.venueName?.trim() || name.trim(),
      spaceType,
      description: description.trim() || null,
    };

    if (spot) {
      await spotListingApi.saveType(token, spot.id, input);
      proceed(spot);
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

  const nameIssue = nameProblem(name);
  const missing = !spaceType
    ? "Select a parking type to continue."
    : !name.trim()
      ? "Name your listing to continue."
      : nameIssue
        ? "Fix the listing name to continue."
        : null;

  return (
    <WizardShell
      title="Your space"
      sub="What are you renting out?"
      step={stepNumber("type")}
      totalSteps={TOTAL_STEPS}
      onBack={back}
      onContinue={save}
      canContinue={missing === null}
      busy={busy}
      error={error}
      footerNote={missing ?? (spot ? undefined : "Nothing is saved until you continue from here. After that, your listing is kept as a draft.")}
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
        label="Name your listing"
        placeholder={NAME_EXAMPLE}
        hint="Choose a clear name that helps drivers identify your parking space."
        error={nameIssue}
        value={name}
        onChangeText={setName}
        maxLength={80}
        returnKeyType="next"
      />

      <Field
        label="Short description"
        optional
        placeholder="Covered parking inside a gated residential society."
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={300}
        style={s.description}
        hint={`Shown to drivers · ${description.length}/300`}
      />
    </WizardShell>
  );
}

const s = StyleSheet.create({
  note: { ...type.caption, color: colors.inkFaint, lineHeight: 18 },
  description: { minHeight: 72 },
});
