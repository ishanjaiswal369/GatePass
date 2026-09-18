import { useEffect, useRef } from "react";
import { Animated, Image, Platform, StyleSheet, View } from "react-native";
import { colors, radius } from "@/theme";

/** How long the brand holds before the app is revealed. */
const HOLD_MS = 2200;
const FADE_MS = 350;

/**
 * Opening brand moment, shown over the app on cold start.
 *
 * It renders the same image as the native splash (assets/splash.png), so on a
 * device the hand-off from the OS splash is invisible -- it simply holds a
 * little longer, then fades to reveal the first screen underneath. On web,
 * where there is no native splash, this is the only place it appears.
 */
export function BrandSplash({ onDone }: { onDone: () => void }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const useNativeDriver = Platform.OS !== "web";

  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: FADE_MS,
        useNativeDriver,
      }).start(({ finished }) => {
        if (finished) onDone();
      });
    }, HOLD_MS);

    return () => clearTimeout(timer);
  }, [opacity, onDone, useNativeDriver]);

  return (
    <Animated.View
      style={[s.overlay, { opacity }]}
      pointerEvents="none"
      accessibilityLabel="GatePass"
    >
      <View style={s.phone}>
        <Image
          source={require("../../../assets/splash.png")}
          style={s.image}
          resizeMode="contain"
        />
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.canvas,
  },
  // Same footprint as PhoneFrame, so the fade reveals the first screen in
  // exactly the place the splash occupied.
  phone: {
    width: 390,
    maxWidth: "100%",
    height: 844,
    maxHeight: "100%",
    backgroundColor: colors.ink,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  image: { width: "100%", height: "100%" },
});
