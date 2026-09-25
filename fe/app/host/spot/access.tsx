import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { spotListingApi } from "@/api";
import { Field, RestoringScreen, WizardShell } from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { useWizardBack } from "@/hooks/useWizardBack";
import { useWizardContinue } from "@/hooks/useWizardContinue";
import {
  TOTAL_STEPS,
  firstStepPath,
  stepHref,
  stepNumber,
} from "@/constants/wizard";
import { ENTRY_METHOD_LABELS, heightLabel } from "@/lib/spotLabels";
import type { EntryMethod } from "@/types/api.types";
import { colors, radius, space, type } from "@/theme";

/**
 * Step 7. How a driver actually gets in.
 *
 * The entry method is a choice (public: "there's a guard" helps a driver
 * decide); the instructions stay free text, because a driver parked outside
 * a closed society gate at 9pm needs the guard's name or the bell to press.
 * Instructions, bay number and marker are shown only after a driver has
 * booked and paid, never in search.
 */
const METHODS: EntryMethod[] = ["SECURITY_GUARD", "GATE_CODE", "INTERCOM", "MANUAL_GATE", "OPEN_ACCESS", "OTHER"];
const EXAMPLES = [
  "Ring flat 402 on the intercom, the guard will open the gate.",
  "Gate code is 4417. Park in the bay marked B-2, not B-1.",
  "Shutter is manual — lift it, and pull it down when you leave.",
];

export default function AccessScreen() {
  const { spot, loading, isRestoring, token } = useSpotDraft();
  const back = useWizardBack("access", spot?.id);
  const proceed = useWizardContinue("access");
  const [text, setText] = useState("");
  const [entry, setEntry] = useState("");
  const [method, setMethod] = useState<EntryMethod | null>(null);
  const [bay, setBay] = useState("");
  const [marker, setMarker] = useState("");

  useEffect(() => {
    if (!spot) return;
    setText(spot.accessInstructions ?? "");
    setEntry(spot.entryPoint ?? "");
    setMethod(spot.entryMethod);
    setBay(spot.bayNumber ?? "");
    setMarker(spot.parkingMarker ?? "");
  }, [spot]);

  const { run: save, busy, error } = useAsyncAction(async () => {
    if (!token || !spot) return;

    await spotListingApi.saveTerms(token, spot.id, {
      accessInstructions: text.trim(),
      entryPoint: entry.trim(),
      ...(method ? { entryMethod: method } : {}),
      bayNumber: bay.trim() || null,
      parkingMarker: marker.trim() || null,
    });

    proceed(spot);
  });

  if (isRestoring || loading) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;
  if (!spot) return <Redirect href={firstStepPath()} />;

  const missing = !method
    ? "Choose how drivers get in."
    : !text.trim()
      ? "Add your access instructions."
      : null;

  return (
    <WizardShell
      title="Getting in"
      sub="What should a driver do when they arrive?"
      step={stepNumber("access")}
      totalSteps={TOTAL_STEPS}
      onBack={back}
      onContinue={save}
      canContinue={missing === null}
      busy={busy}
      error={error}
      footerNote={missing ?? undefined}
    >
      <View style={s.group}>
        <Text style={s.groupTitle}>ENTRY METHOD</Text>
        <View style={s.chips} accessibilityRole="radiogroup">
          {METHODS.map((m) => {
            const on = method === m;
            return (
              <Pressable
                key={m}
                onPress={() => setMethod(m)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                    aria-checked={on}
                style={[s.chip, on && s.chipOn]}
              >
                <Text style={[s.chipText, on && s.chipTextOn]}>{ENTRY_METHOD_LABELS[m]}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Field
        label="Access instructions"
        value={text}
        onChangeText={setText}
        placeholder="Ring Flat 402 on the intercom. Security will open the main gate. Park in bay B-2."
        multiline
        numberOfLines={5}
        maxLength={1000}
        style={s.textArea}
        hint={`Tell drivers exactly what to do when they arrive · ${text.length}/1000`}
      />

      <View style={s.group}>
        <Text style={s.groupTitle}>PARKING IDENTIFICATION</Text>
        <View style={s.pair}>
          <View style={s.bayField}>
            <Field label="Bay number" optional value={bay} onChangeText={setBay} placeholder="B-2" maxLength={20} />
          </View>
          <View style={s.flex}>
            <Field
              label="Parking marker"
              optional
              value={marker}
              onChangeText={setMarker}
              placeholder="Blue sign next to the entrance"
              maxLength={120}
            />
          </View>
        </View>
      </View>

      <View style={s.group}>
        <Text style={s.groupTitle}>ACCESS RESTRICTIONS</Text>
        <Field
          label="Entry gate"
          optional
          value={entry}
          onChangeText={setEntry}
          placeholder="Main gate on Karve Road"
          maxLength={120}
          hint="Which gate or entrance. Drivers see this before booking."
        />
        <View style={s.heightRow}>
          <Text style={s.gate}>
            Maximum vehicle height: {spot.maxVehicleHeightCm ? heightLabel(spot.maxVehicleHeightCm) : "none set"}
          </Text>
          <Pressable onPress={() => router.push(stepHref("details", spot.id))} accessibilityRole="link" hitSlop={10}>
            <Text style={s.edit}>Edit</Text>
          </Pressable>
        </View>
        <Text style={s.gate}>
          Gate timing: {spot.availability.length ? "your opening hours, from the Availability step" : "set in the Availability step"}.
        </Text>
      </View>

      <View style={s.examples}>
        <Text style={s.examplesTitle}>What helps</Text>
        {EXAMPLES.map((example) => (
          <Text key={example} style={s.example}>
            “{example}”
          </Text>
        ))}
      </View>

      <Text style={s.note}>
        Instructions, bay number and marker are shown only after a driver has booked and paid, never in search.
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
  gate: { fontSize: 13, color: colors.inkMuted, flex: 1 },
  group: { gap: space.md },
  groupTitle: { ...type.label, color: colors.inkMuted, letterSpacing: 0.6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontSize: 14, fontWeight: "600", color: colors.ink },
  chipTextOn: { color: colors.onInk },
  pair: { flexDirection: "row", gap: space.md },
  bayField: { width: 110 },
  flex: { flex: 1 },
  heightRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  edit: { fontSize: 14, fontWeight: "600", color: colors.ink, textDecorationLine: "underline" },
});
