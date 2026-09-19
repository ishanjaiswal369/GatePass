import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, HIT_SLOP_MIN, space } from "@/theme";
import { CalendarIcon, HomeIcon, HostIcon, UserIcon } from "./Icon";

export type NavKey = "home" | "bookings" | "host" | "profile";

const ITEMS: { key: NavKey; label: string; Icon: typeof HomeIcon }[] = [
  { key: "home", label: "Home", Icon: HomeIcon },
  { key: "bookings", label: "Bookings", Icon: CalendarIcon },
  // Host is one nav item, not a whole mode switch: tapping it opens
  // onboarding or the dashboard depending on whether a profile exists.
  { key: "host", label: "Host", Icon: HostIcon },
  { key: "profile", label: "Profile", Icon: UserIcon },
];

export function BottomNav({
  active,
  onNavigate,
}: {
  active: NavKey;
  onNavigate: (key: NavKey) => void;
}) {
  return (
    <View style={s.bar}>
      {ITEMS.map(({ key, label, Icon }) => {
        const isActive = key === active;
        return (
          <Pressable
            key={key}
            onPress={() => onNavigate(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            style={s.item}
          >
            <Icon color={isActive ? colors.ink : colors.inkFaint} />
            <Text style={[s.label, isActive && s.labelActive]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    height: 78,
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  item: {
    flexGrow: 1,
    flexBasis: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: HIT_SLOP_MIN,
  },
  label: { fontSize: 11, color: colors.inkMuted },
  labelActive: { color: colors.ink, fontWeight: "700" },
});
