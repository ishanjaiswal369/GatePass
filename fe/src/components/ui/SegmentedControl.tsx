import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, HIT_SLOP_MIN, radius, space, type } from "@/theme";

export interface Segment<T extends string> {
  value: T;
  label: string;
}

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
}: {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <View style={s.track}>
      {segments.map((segment) => {
        const active = segment.value === value;
        return (
          <Pressable
            key={segment.value}
            onPress={() => onChange(segment.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[s.segment, active && s.segmentActive]}
          >
            <Text style={[s.label, active && s.labelActive]}>
              {segment.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  track: {
    flexDirection: "row",
    gap: space.xs,
    backgroundColor: colors.canvas,
    borderRadius: radius.sm,
    padding: space.xs,
  },
  segment: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: space.md,
    borderRadius: radius.sm - 2,
    minHeight: HIT_SLOP_MIN,
  },
  segmentActive: { backgroundColor: colors.surface },
  label: { ...type.label, color: colors.inkMuted },
  labelActive: { color: colors.ink },
});
