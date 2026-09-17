import { StyleSheet, Text, View } from "react-native";
import { colors, space, type } from "@/theme";

export function DataRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value ?? "—"}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  label: { ...type.body, color: colors.inkMuted },
  value: { ...type.body, color: colors.ink, fontWeight: "600", flexShrink: 1 },
});
