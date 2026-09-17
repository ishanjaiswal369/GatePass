import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { colors, radius } from "@/theme";

/**
 * Centres the app in a phone-sized shell so it can be driven in a browser.
 * Content is full-bleed inside it -- screens own their own header and padding,
 * which is what the designs assume.
 */
export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <View style={s.canvas}>
      <View style={s.phone}>{children}</View>
    </View>
  );
}

const s = StyleSheet.create({
  canvas: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.canvas,
  },
  phone: {
    width: 390,
    maxWidth: "100%",
    height: 844,
    maxHeight: "100%",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
});
