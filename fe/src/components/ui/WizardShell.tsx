import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, radius, space, type } from "@/theme";
import { Button } from "./Button";
import { ErrorNotice } from "./Notice";
import { PhoneFrame } from "./PhoneFrame";
import { ScreenHeader } from "./ScreenHeader";

/**
 * One step of the listing wizard.
 *
 * The primary action sits in a pinned footer rather than at the end of the
 * scroll: several steps are long enough to scroll, and a Continue button a
 * host has to hunt for reads as a dead end.
 *
 * There is no "skip" affordance. Every step here is required before review,
 * so an escape hatch would only move the refusal to the end.
 */
export function WizardShell({
  title,
  sub,
  step,
  totalSteps,
  onBack,
  onContinue,
  continueLabel = "Continue",
  canContinue = true,
  busy,
  error,
  footerNote,
  children,
}: {
  title: string;
  sub?: string;
  /** 1-based, for "Step 3 of 9". */
  step: number;
  totalSteps: number;
  onBack: () => void;
  onContinue: () => void;
  continueLabel?: string;
  canContinue?: boolean;
  busy?: boolean;
  error?: string | null;
  /** A line under the button, for a caveat the step needs to carry. */
  footerNote?: string;
  children: ReactNode;
}) {
  const progress = Math.min(Math.max(step / totalSteps, 0), 1);

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader title={title} sub={sub} onBack={onBack} />

        <View style={s.progressRow}>
          <View style={s.track}>
            <View style={[s.fill, { width: `${progress * 100}%` }]} />
          </View>
          <Text style={s.stepText}>
            {step} of {totalSteps}
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={s.body}
          keyboardShouldPersistTaps="handled"
        >
          {error ? <ErrorNotice message={error} /> : null}
          {children}
        </ScrollView>

        <View style={s.footer}>
          <Button
            label={continueLabel}
            onPress={onContinue}
            disabled={!canContinue}
            busy={busy}
            size="lg"
          />
          {footerNote ? <Text style={s.footerNote}>{footerNote}</Text> : null}
        </View>
      </View>
    </PhoneFrame>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: 20,
    paddingTop: space.lg,
  },
  track: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    overflow: "hidden",
  },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.ink },
  stepText: { ...type.caption, color: colors.inkMuted },
  body: { padding: 20, gap: space.lg, paddingBottom: space.xxl },
  footer: {
    padding: 20,
    gap: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  footerNote: {
    ...type.caption,
    color: colors.inkFaint,
    textAlign: "center",
  },
});
