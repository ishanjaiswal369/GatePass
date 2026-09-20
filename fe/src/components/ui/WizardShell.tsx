import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useScreenInsets } from "@/hooks/useScreenInsets";
import { colors, HIT_SLOP_MIN, space, type } from "@/theme";
import { Button } from "./Button";
import { ChevronLeftIcon } from "./Icon";
import { ErrorNotice } from "./Notice";
import { PhoneFrame } from "./PhoneFrame";

/**
 * One step of the listing wizard.
 *
 * Header is the Host tab's, not the dark band the account screens use: the
 * wizard opens from the Host tab and returns to it, so a dark header here
 * reads as having left the section rather than moved within it.
 *
 * The primary action sits in a pinned footer rather than at the end of the
 * scroll: several steps are long enough to scroll, and a Continue button a
 * host has to hunt for reads as a dead end.
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
  const insets = useScreenInsets();
  const progress = Math.min(Math.max(step / totalSteps, 0), 1);

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <View style={[s.header, { paddingTop: insets.top + 20 }]}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={s.back}
          >
            <ChevronLeftIcon color={colors.ink} />
          </Pressable>

          <View style={s.progressRow}>
            <View style={s.track}>
              <View style={[s.fill, { width: `${progress * 100}%` }]} />
            </View>
            <Text style={s.stepText}>
              {step} of {totalSteps}
            </Text>
          </View>

          <View style={s.heading}>
            <Text style={s.title}>{title}</Text>
            {sub ? <Text style={s.sub}>{sub}</Text> : null}
          </View>
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
  screen: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: 20, gap: space.lg },
  back: {
    width: HIT_SLOP_MIN,
    height: HIT_SLOP_MIN,
    marginLeft: -12,
    alignItems: "center",
    justifyContent: "center",
  },
  progressRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  track: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    overflow: "hidden",
  },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.ink },
  stepText: { ...type.caption, color: colors.inkMuted },
  heading: { gap: 6 },
  title: {
    fontSize: 27,
    fontWeight: "700",
    color: colors.ink,
    letterSpacing: -0.5,
  },
  sub: { fontSize: 15, color: colors.inkMuted, lineHeight: 22 },
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
