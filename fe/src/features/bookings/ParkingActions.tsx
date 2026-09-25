import { router } from "expo-router";
import type { ReactNode } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { ClockIcon, NavigateIcon, PhoneIcon, WarningIcon } from "@/components/ui";
import { bookingListing, directionsUrl, isSpotBooking } from "@/lib/booking";
import { colors, radius, space } from "@/theme";
import type { BookingRow } from "@/types/api.types";

/**
 * What a parked driver can do, as the prototype's 2×2 grid: more time, the
 * way there, the host, and "it's not working".
 *
 * Contact Host is shown but not live: calls are meant to go through a masked
 * number so neither side learns the other's, and no telephony provider is
 * wired. Saying so beats a button that silently does nothing.
 */
export function ParkingActions({ row }: { row: BookingRow }) {
  const directions = directionsUrl(bookingListing(row));
  const spot = isSpotBooking(row);
  const reported = row.problem !== null;

  return (
    <View style={s.grid}>
      {spot ? (
        <Tile
          icon={<ClockIcon size={18} color={colors.ink} />}
          title="Extend Parking"
          sub="Add more time"
          onPress={() => router.push({ pathname: "/booking/[id]/extend", params: { id: row.id } })}
        />
      ) : null}
      {directions ? (
        <Tile
          icon={<NavigateIcon size={18} color={colors.ink} />}
          title="Get Directions"
          sub="Opens your maps app"
          onPress={() => void Linking.openURL(directions)}
        />
      ) : null}
      <Tile icon={<PhoneIcon size={18} />} title="Contact Host" sub="Masked calling isn't available yet" disabled />
      {spot ? (
        <Tile
          icon={<WarningIcon size={18} />}
          title={reported ? "Your Report" : "Report a Problem"}
          sub={reported ? (row.problem!.status === "OPEN" ? "Under review" : "Resolved") : "Can't park? Tell us"}
          onPress={() =>
            router.push({ pathname: reported ? "/booking/[id]/problem" : "/booking/[id]/report", params: { id: row.id } })
          }
        />
      ) : null}
    </View>
  );
}

function Tile({
  icon,
  title,
  sub,
  onPress,
  disabled,
}: {
  icon: ReactNode;
  title: string;
  sub: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      accessibilityLabel={`${title}. ${sub}`}
      style={({ pressed }) => [s.tile, disabled && s.disabled, pressed && s.pressed]}
    >
      <View style={s.icon}>{icon}</View>
      <View style={s.gap2}>
        <Text style={s.title}>{title}</Text>
        <Text style={s.sub}>{sub}</Text>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: {
    // Two per row inside the 20px screen gutter, with the 10px gap between.
    flexBasis: "47%",
    flexGrow: 1,
    minHeight: 92,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 14,
    gap: space.sm,
    backgroundColor: colors.surface,
  },
  disabled: { opacity: 0.55 },
  pressed: { backgroundColor: colors.canvas },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.canvas,
    alignItems: "center",
    justifyContent: "center",
  },
  gap2: { gap: 2 },
  title: { fontSize: 14, fontWeight: "700", color: colors.ink },
  sub: { fontSize: 12, color: colors.inkMuted },
});
