import { StyleSheet, Text, View } from "react-native";
import { KeyIcon, LockIcon } from "@/components/ui";
import { colors, radius, space } from "@/theme";

/**
 * How to get into the space.
 *
 * Drawn heavier than anything around it: a driver standing at a gate at 9 pm
 * is looking for exactly this, and it is the one thing on the screen they
 * cannot work out for themselves. Until the booking is paid the API does not
 * send the instructions, and the card says why instead of showing a blank.
 */
export function AccessCard({
  instructions,
  released,
  noun = "booking",
  bayNumber,
  parkingMarker,
}: {
  instructions: string | null;
  released: boolean;
  /** What was paid for: "booking", or "reservation" for a monthly term. */
  noun?: string;
  /** Which bay, and how to recognise it -- released with the instructions. */
  bayNumber?: string | null;
  parkingMarker?: string | null;
}) {
  return (
    <View style={s.card}>
      <View style={s.head}>
        <View style={s.badge}>
          <KeyIcon size={18} color={colors.onInk} />
        </View>
        <Text style={s.title} accessibilityRole="header">
          Access instructions
        </Text>
      </View>

      {released ? (
        <>
          {bayNumber ? <Text style={s.bay}>Bay {bayNumber}</Text> : null}
          {parkingMarker ? <Text style={s.marker}>{parkingMarker}</Text> : null}
          <Text style={s.body}>
            {instructions?.trim() ||
              `The host hasn't added instructions. Show this ${noun} to security or the host at the gate.`}
          </Text>
        </>
      ) : (
        <View style={s.locked}>
          <LockIcon size={15} color={colors.inkMuted} />
          <Text style={s.lockedText}>Shared as soon as this {noun} is paid.</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: 14,
    padding: space.lg,
    gap: space.md,
    backgroundColor: colors.surface,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  badge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 16, fontWeight: "700", color: colors.ink },
  body: { fontSize: 15, lineHeight: 22, color: colors.ink },
  bay: { fontSize: 20, fontWeight: "700", color: colors.ink },
  marker: { fontSize: 14, color: colors.inkMuted, marginTop: -8 },
  locked: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: colors.canvas,
    borderRadius: radius.sm,
    padding: space.md,
  },
  lockedText: { flex: 1, fontSize: 13, color: colors.inkMuted },
});
