import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useScreenInsets } from "@/hooks/useScreenInsets";
import { colors, HIT_SLOP_MIN, space } from "@/theme";
import { ChevronLeftIcon } from "./Icon";

/**
 * The dark band the rest of the app leads with: same ink surface, same 22px
 * bottom corners as the home screen's header, so a profile screen reads as
 * part of the same app rather than a settings page bolted on.
 *
 * The background runs under the status bar and only the content is inset --
 * padding the whole band would leave a white strip above it on a notched
 * phone.
 */
export function ScreenHeader({
  title,
  sub,
  initial,
  onBack,
  leading,
}: {
  title: string;
  sub?: string | null;
  /** Renders the avatar disc instead of a back button, for a root screen. */
  initial?: string;
  onBack?: () => void;
  /**
   * An action for the top-left corner of a root screen, which has no back
   * button to put there. The avatar moves to the right to make room.
   */
  leading?: ReactNode;
}) {
  const insets = useScreenInsets();

  return (
    <View style={[s.header, { paddingTop: insets.top + 20 }]}>
      <View style={s.row}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={s.backHit}
          >
            <ChevronLeftIcon color={colors.onInk} />
          </Pressable>
        ) : leading ? (
          leading
        ) : null}

        {initial ? (
          <View style={[s.avatar, leading ? s.avatarRight : null]}>
            <Text style={s.avatarText}>{initial}</Text>
          </View>
        ) : null}
      </View>

      <View style={s.copy}>
        <Text style={s.title}>{title}</Text>
        {sub ? <Text style={s.sub}>{sub}</Text> : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    backgroundColor: colors.ink,
    paddingHorizontal: 20,
    paddingBottom: 22,
    gap: space.lg,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
  },
  row: { flexDirection: "row", alignItems: "center", minHeight: 34 },
  backHit: {
    width: HIT_SLOP_MIN,
    height: HIT_SLOP_MIN,
    marginLeft: -12,
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.inkRaised,
    borderWidth: 1,
    borderColor: colors.inkRaisedBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarRight: { marginLeft: "auto" },
  avatarText: { fontSize: 14, fontWeight: "600", color: colors.onInk },
  copy: { gap: 4 },
  title: {
    fontSize: 25,
    fontWeight: "700",
    color: colors.onInk,
    letterSpacing: -0.4,
  },
  sub: { fontSize: 14, color: colors.onInkMuted },
});
