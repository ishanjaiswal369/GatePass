import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, space, type } from "@/theme";
import { Button } from "./Button";
import { ErrorNotice } from "./Notice";
import { PhoneFrame } from "./PhoneFrame";
import { SectionHeader } from "./SectionHeader";

/**
 * One step of the listing wizard: the Host section's header with a progress
 * bar, a scrolling body, and the step's action pinned to the bottom.
 *
 * The action sits in a pinned footer rather than at the end of the scroll:
 * several steps are long enough to scroll, and a Continue button a host has
 * to hunt for reads as a dead end.
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
  return (
    <PhoneFrame>
      <View style={s.screen}>
        <SectionHeader
          title={title}
          sub={sub}
          onBack={onBack}
          progress={{ step, total: totalSteps }}
        />

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
  screen: { flex: 1, backgroundColor: colors.surface },
  body: {
    paddingHorizontal: 20,
    paddingTop: space.xl,
    paddingBottom: space.xxl,
    gap: space.lg,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: space.lg,
    paddingBottom: space.lg,
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
