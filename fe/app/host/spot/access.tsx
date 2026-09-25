import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { spotListingApi } from "@/api";
import { Field, RestoringScreen, WizardShell } from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { useWizardBack } from "@/hooks/useWizardBack";
import { continueAfter } from "@/lib/wizardFlow";
import {
  TOTAL_STEPS,
  firstStepPath,
  nextStepPath,
  stepNumber,
} from "@/constants/wizard";
import { colors, radius, space, type } from "@/theme";

/**
 * Step 6. How a driver actually gets in.
 *
 * Free text, not a yes/no "is there a gate". A driver parked outside a closed
 * society gate at 9pm needs the guard's name or the bell to press; a boolean
 * tells them nothing they cannot already see.
 */
const EXAMPLES = [
  "Ring flat 402 on the intercom, the guard will open the gate.",
  "Gate code is 4417. Park in the bay marked B-2, not B-1.",
  "Shutter is manual — lift it, and pull it down when you leave.",
];

export default function AccessScreen() {
  const { spot, loading, isRestoring, token } = useSpotDraft();
  const back = useWizardBack("access", spot?.id);
  const [text, setText] = useState("");
  const [entry, setEntry] = useState("");

  useEffect(() => {
    if (!spot) return;
    setText(spot.accessInstructions ?? "");
    setEntry(spot.entryPoint ?? "");
  }, [spot]);

  const { run: save, busy, error } = useAsyncAction(async () => {
    if (!token || !spot) return;

    await spotListingApi.saveTerms(token, spot.id, {
      accessInstructions: text.trim(),
      entryPoint: entry.trim(),
    });

    continueAfter("access", spot);
  });

  if (isRestoring || loading) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;
  if (!spot) return <Redirect href={firstStepPath()} />;

  return (
    <WizardShell
      title="How do drivers get in?"
      sub="The entry point is public; the instructions are shown only after a driver has booked and paid."
      step={stepNumber("access")}
      totalSteps={TOTAL_STEPS}
      onBack={back}
      onContinue={save}
      canContinue={text.trim().length > 0}
      busy={busy}
      error={error}
    >
      <Field
        label="Entry point"
        optional
        value={entry}
        onChangeText={setEntry}
        placeholder="Main gate on Karve Road"
        maxLength={120}
        hint="Which gate or entrance. Drivers see this before booking."
      />

      <Text style={s.gate}>
        Gate timing: {spot.availability.length ? "your opening hours, from the Availability step" : "set in the Availability step"}.
      </Text>

      <Field
        label="Access instructions"
        value={text}
        onChangeText={setText}
        placeholder="Ring flat 402, the guard will open the gate."
        multiline
        numberOfLines={5}
        maxLength={1000}
        style={s.textArea}
        hint={`${text.length}/1000`}
      />

      <View style={s.examples}>
        <Text style={s.examplesTitle}>What helps</Text>
        {EXAMPLES.map((example) => (
          <Text key={example} style={s.example}>
            “{example}”
          </Text>
        ))}
      </View>

      <Text style={s.note}>
        This is shown only after a driver has booked and paid, never in search.
      </Text>
    </WizardShell>
  );
}

const s = StyleSheet.create({
  // Height only. Everything else about how the input sits in its box is
  // Field's own business -- see the note there about merging this style.
  textArea: { minHeight: 120 },
  examples: {
    gap: space.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
  },
  examplesTitle: { ...type.label, color: colors.ink },
  example: { fontSize: 13, lineHeight: 19, color: colors.inkMuted },
  note: { ...type.caption, color: colors.inkFaint, lineHeight: 18 },
  gate: { fontSize: 13, color: colors.inkMuted },
});
