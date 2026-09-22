import { Pressable, StyleSheet, Text, View } from "react-native";
import { useScreenInsets } from "@/hooks/useScreenInsets";
import { colors, HIT_SLOP_MIN, space, type } from "@/theme";
import { ChevronLeftIcon } from "./Icon";

/**
 * The Host section's header: light, on the body's own surface.
 *
 * Deliberately not `ScreenHeader`'s dark ink band. That one marks a screen
 * reached from the app's chrome -- the account hub, a pass -- and the whole
 * host flow lives inside the Host tab, so a dark band partway through reads
 * as having left the section rather than moved within it. The listing status
 * screen used one and looked like a different app.
 *
 * `progress` is what makes this a wizard step rather than a plain page.
 */
export function SectionHeader({
  title,
  sub,
  onBack,
  progress,
}: {
  title: string;
  sub?: string | null;
  onBack?: () => void;
  /** 1-based: `{ step: 3, total: 9 }` renders "3 of 9". */
  progress?: { step: number; total: number };
}) {
  const insets = useScreenInsets();
  const filled = progress
    ? Math.min(Math.max(progress.step / progress.total, 0), 1)
    : 0;

  return (
    <View style={[s.header, { paddingTop: insets.top + 20 }]}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={s.back}
        >
          <ChevronLeftIcon color={colors.ink} />
        </Pressable>
      ) : null}

      {progress ? (
        <View style={s.progressRow}>
          <View style={s.track}>
            <View style={[s.fill, { width: `${filled * 100}%` }]} />
          </View>
          <Text style={s.stepText}>
            {progress.step} of {progress.total}
          </Text>
        </View>
      ) : null}

      <View style={s.heading}>
        <Text style={s.title}>{title}</Text>
        {sub ? <Text style={s.sub}>{sub}</Text> : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
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
});
