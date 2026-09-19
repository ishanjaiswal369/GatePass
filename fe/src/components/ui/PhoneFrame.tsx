import type { ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { colors, radius } from "@/theme";

/**
 * On web, centres the app in a phone-sized shell so the designs can be driven
 * in a browser. On a real device there is nothing to simulate -- the screen IS
 * the phone -- so this is a plain full-bleed container. Without the branch a
 * handset would render the app as a rounded, shadowed card floating inside its
 * own screen.
 *
 * Content is full-bleed inside it either way: screens own their own header and
 * padding, which is what the designs assume.
 */
export function PhoneFrame({ children }: { children: ReactNode }) {
  if (Platform.OS !== "web") {
    return <View style={s.native}>{children}</View>;
  }

  return (
    <View style={s.canvas}>
      <View style={s.phone}>{children}</View>
    </View>
  );
}

const s = StyleSheet.create({
  native: { flex: 1, backgroundColor: colors.surface },
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
