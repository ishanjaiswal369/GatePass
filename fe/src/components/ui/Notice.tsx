import { StyleSheet, Text, View } from "react-native";
import { colors, radius, space, type } from "@/theme";

/** Error surface. Every screen shows failures the same way. */
export function ErrorNotice({ message }: { message: string }) {
  return (
    <View style={s.error}>
      <Text style={s.errorText}>{message}</Text>
    </View>
  );
}

/**
 * Shows the login code the API echoes back while EMAIL_PROVIDER=console.
 * Disappears on its own in production, because the API stops sending it.
 */
export function DevCodeNotice({ code }: { code: string }) {
  return (
    <View style={s.dev}>
      <Text style={s.devLabel}>DEV — code from API response</Text>
      <Text style={s.devCode}>{code}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  error: {
    backgroundColor: colors.dangerSurface,
    borderRadius: radius.sm,
    padding: space.md,
  },
  errorText: { ...type.body, color: colors.danger },
  dev: {
    backgroundColor: colors.devSurface,
    borderWidth: 1,
    borderColor: colors.devBorder,
    borderRadius: radius.sm,
    padding: space.md,
    gap: space.xs,
  },
  devLabel: { ...type.caption, color: colors.devInk, fontWeight: "600" },
  devCode: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: 4,
    color: colors.devInk,
  },
});
