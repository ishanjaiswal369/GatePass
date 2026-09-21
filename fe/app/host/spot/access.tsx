import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { spotListingApi } from "@/api";
import { Field, RestoringScreen, WizardShell } from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { TOTAL_STEPS, nextStepPath, stepNumber } from "@/constants/wizard";
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
  const [text, setText] = useState("");

  useEffect(() => {
    if (!spot) return;
    setText(spot.accessInstructions ?? "");
  }, [spot]);

  const { run: save, busy, error } = useAsyncAction(async () => {
    if (!token || !spot) return;

    await spotListingApi.saveTerms(token, spot.id, {
      accessInstructions: text.trim(),
    });

    router.push(nextStepPath("access", spot.id));
  });

  if (isRestoring || loading) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;
  if (!spot) return <Redirect href="/host/spot" />;

  return (
    <WizardShell
      title="Getting in"
      sub="What should a driver do when they arrive?"
      step={stepNumber("access")}
      totalSteps={TOTAL_STEPS}
      onBack={() => router.back()}
      onContinue={save}
      canContinue={text.trim().length > 0}
      busy={busy}
      error={error}
    >
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
  textArea: { minHeight: 120, textAlignVertical: "top" },
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
});
