import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, View } from "react-native";
import { colors, radius, space } from "@/theme";

/**
 * "We're listening": a live status, not a warning. The pulsing dot says the
 * screen is checking by itself, so the driver doesn't need to refresh.
 */
export function PaymentWaiting({ title, body }: { title: string; body: string }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1400,
        easing: Easing.out(Easing.ease),
        useNativeDriver: Platform.OS !== "web",
      })
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const ring = {
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
  };

  return (
    <View style={s.box} accessibilityRole="summary" accessibilityLiveRegion="polite">
      <View style={s.dotWrap}>
        <Animated.View style={[s.ring, ring]} />
        <View style={s.dot} />
      </View>
      <View style={s.copy}>
        <Text style={s.title}>{title}</Text>
        <Text style={s.body}>{body}</Text>
      </View>
    </View>
  );
}

const DOT = 10;

const s = StyleSheet.create({
  box: {
    flexDirection: "row",
    gap: space.md,
    alignItems: "flex-start",
    backgroundColor: colors.canvas,
    borderRadius: radius.md,
    padding: 14,
  },
  dotWrap: { width: DOT * 2, height: 20, alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: colors.accent },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: colors.accent },
  copy: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: "700", color: colors.ink },
  body: { fontSize: 13, lineHeight: 19, color: colors.inkMuted },
});
