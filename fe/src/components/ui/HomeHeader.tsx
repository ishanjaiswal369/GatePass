import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useScreenInsets } from "@/hooks/useScreenInsets";
import { colors, HIT_SLOP_MIN, radius, space } from "@/theme";
import { SearchIcon } from "./Icon";

function BarrierMark({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 3v18" stroke={colors.onInk} strokeWidth={2} strokeLinecap="round" />
      <Path d="M4 6.5h15" stroke={colors.onInk} strokeWidth={2} strokeLinecap="round" />
      <Path d="M8.5 6.5v5M13 6.5v5M17.5 6.5v5" stroke={colors.onInk} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

/**
 * The dark band on the home screen: wordmark, avatar, headline and search.
 *
 * Search is a controlled input owned by the screen, so both tabs share this
 * header while searching different things.
 */
export function HomeHeader({
  initial,
  placeholder,
  query,
  onChangeQuery,
  onSubmitQuery,
  onPressProfile,
}: {
  initial: string;
  placeholder: string;
  query: string;
  onChangeQuery: (next: string) => void;
  onSubmitQuery?: () => void;
  onPressProfile: () => void;
}) {
  const insets = useScreenInsets();

  return (
    // The background extends under the status bar; only the content is inset.
    <View style={[s.header, { paddingTop: insets.top + 20 }]}>
      <View style={s.row}>
        <View style={s.brand}>
          <BarrierMark />
          <Text style={s.wordmark}>GatePass</Text>
        </View>
        <Pressable
          onPress={onPressProfile}
          accessibilityRole="button"
          accessibilityLabel="Your profile"
          style={s.avatarHit}
        >
          <View style={s.avatar}>
            <Text style={s.avatarText}>{initial}</Text>
          </View>
        </Pressable>
      </View>

      <Text style={s.headline}>Where are you headed?</Text>

      <View style={s.search}>
        <SearchIcon color={colors.onInkMuted} />
        <TextInput
          value={query}
          onChangeText={onChangeQuery}
          onSubmitEditing={onSubmitQuery}
          returnKeyType="search"
          placeholder={placeholder}
          placeholderTextColor={colors.onInkMuted}
          accessibilityLabel={placeholder}
          style={s.input}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    backgroundColor: colors.ink,
    paddingBottom: 18,
    paddingHorizontal: 20,
    gap: space.lg,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
  },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  wordmark: {
    fontSize: 19,
    fontWeight: "700",
    color: colors.onInk,
    letterSpacing: -0.2,
  },
  avatarHit: {
    width: HIT_SLOP_MIN,
    height: HIT_SLOP_MIN,
    marginRight: -8,
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
  avatarText: { fontSize: 14, fontWeight: "600", color: colors.onInk },
  headline: {
    fontSize: 21,
    fontWeight: "600",
    color: colors.onInk,
    letterSpacing: -0.3,
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 48,
    paddingHorizontal: 14,
    backgroundColor: colors.inkSurface,
    borderWidth: 1,
    borderColor: colors.inkBorder,
    borderRadius: radius.md,
  },
  input: {
    flexGrow: 1,
    flexShrink: 1,
    fontSize: 15,
    color: colors.onInk,
    // Web adds a focus ring that fights the container's own border.
    outlineStyle: "none",
  } as never,
});
