import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius, space, type } from "@/theme";

/**
 * Bordered group with a small uppercase heading, and an optional badge on the
 * same row -- for a card whose heading names a thing (a spot) that also has a
 * short-lived state (its status) worth seeing without reading into the body.
 */
export function Card({
  heading,
  badge,
  children,
}: {
  heading: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={s.card}>
      <View style={s.headingRow}>
        <Text style={s.heading}>{heading}</Text>
        {badge}
      </View>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.xs,
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
    marginBottom: space.xs,
  },
  heading: {
    ...type.label,
    color: colors.inkMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
});
