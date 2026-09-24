import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, space } from "@/theme";

/**
 * What a screen says when it has nothing to show: what is missing, and the
 * one thing to do about it. Never a blank area -- a first-time driver reads
 * an empty screen as broken.
 */
export function EmptyState({
  icon,
  title,
  body,
  children,
}: {
  icon: ReactNode;
  title: string;
  body?: string;
  /** The action, usually one Button. */
  children?: ReactNode;
}) {
  return (
    <View style={s.wrap}>
      <View style={s.badge}>{icon}</View>
      <Text style={s.title}>{title}</Text>
      {body ? <Text style={s.body}>{body}</Text> : null}
      {children ? <View style={s.action}>{children}</View> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: "center", gap: space.md, paddingVertical: 40, paddingHorizontal: space.lg },
  badge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.canvas,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 19, fontWeight: "700", color: colors.ink, textAlign: "center" },
  body: { fontSize: 14, lineHeight: 21, color: colors.inkMuted, textAlign: "center", maxWidth: 300 },
  action: { alignSelf: "stretch", paddingTop: space.sm },
});
