import { StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { colors, space } from "@/theme";

/** The parking-barrier mark: post plus boom with drop bars. */
function BarrierMark({ size = 26 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 20V6"
        stroke={colors.onInk}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path
        d="M4 8h16"
        stroke={colors.onInk}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path
        d="M8 8v3M12 8v3M16 8v3"
        stroke={colors.onInk}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Dark band at the top of the auth screens: wordmark, headline, sub. */
export function BrandHeader({
  headline,
  sub,
}: {
  headline: string;
  sub: string;
}) {
  return (
    <View style={s.header}>
      <View style={s.brand}>
        <BarrierMark />
        <Text style={s.wordmark}>GatePass</Text>
      </View>
      <View style={s.copy}>
        <Text style={s.headline}>{headline}</Text>
        <Text style={s.sub}>{sub}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    backgroundColor: colors.ink,
    paddingTop: 56,
    paddingBottom: space.xxl,
    paddingHorizontal: 28,
    gap: 22,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  wordmark: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.onInk,
    letterSpacing: -0.2,
  },
  copy: { gap: 6 },
  headline: {
    fontSize: 27,
    fontWeight: "700",
    color: colors.onInk,
    letterSpacing: -0.5,
    lineHeight: 33,
  },
  sub: { fontSize: 14, color: "rgba(255,255,255,0.65)", lineHeight: 21 },
});
