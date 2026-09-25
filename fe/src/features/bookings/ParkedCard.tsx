import { router } from "expo-router";
import type { ReactNode } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { CheckIcon, ClockIcon, NavigateIcon } from "@/components/ui";
import {
  bookingListing,
  clockTime,
  directionsUrl,
  isSpotBooking,
  stayProgress,
  timeLeft,
} from "@/lib/booking";
import { colors, radius, space } from "@/theme";
import type { BookingRow } from "@/types/api.types";

const MINT = "#86efac";

/**
 * The booking a driver is parked on, drawn to be found at a glance: the one
 * dark card in a light list, with the time left in the largest type on the
 * screen.
 *
 * `compact` drops the "open" button and the inline actions, for the parking
 * screen and the booking screen, which carry their own.
 */
export function ParkedCard({
  row,
  now,
  compact,
}: {
  row: BookingRow;
  now: number;
  compact?: boolean;
}) {
  const listing = bookingListing(row);
  const end = row.effectiveEndsAt ?? row.endsAt;
  const progress = stayProgress(row, now);
  const directions = directionsUrl(listing);
  const where = [listing?.addressLine, listing?.city].filter(Boolean).join(", ");

  return (
    <View style={s.card}>
      <View style={s.top}>
        <View style={s.parked}>
          <CheckIcon size={15} color={MINT} />
          <Text style={s.parkedText}>YOU ARE PARKED</Text>
        </View>
        <Text style={s.ref}>{row.vehicleNumber}</Text>
      </View>

      <View style={s.gap2}>
        <Text style={s.name}>{listing?.name ?? "Parking"}</Text>
        {where ? <Text style={s.muted}>{where}</Text> : null}
      </View>

      {end ? (
        <>
          <View style={s.timeRow}>
            <View style={s.gap2}>
              <Text style={s.muted}>Remaining</Text>
              <Text style={s.remaining} accessibilityRole="timer">
                {timeLeft(end, now)}
              </Text>
            </View>
            {row.startsAt ? (
              <Text style={s.range}>
                {clockTime(row.startsAt)} → {clockTime(end)}
              </Text>
            ) : null}
          </View>
          <View
            style={s.track}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
            accessibilityLabel="Time used"
          >
            <View style={[s.fill, { width: `${progress * 100}%` }]} />
          </View>
        </>
      ) : null}

      {end && new Date(end).getTime() > now ? (
        <Text style={s.remind}>
          We'll remind you at {clockTime(new Date(new Date(end).getTime() - 30 * 60_000).toISOString())}, 30 minutes before it
          ends.
        </Text>
      ) : null}

      {compact ? null : (
      <View style={s.actions}>
        {directions ? (
          <Action
            icon={<NavigateIcon size={18} color={colors.onInk} />}
            label="Get Directions"
            onPress={() => void Linking.openURL(directions)}
          />
        ) : null}
        {isSpotBooking(row) ? (
          <Action
            icon={<ClockIcon size={18} color={colors.onInk} />}
            label="Extend Parking"
            onPress={() => router.push({ pathname: "/booking/[id]/extend", params: { id: row.id } })}
          />
        ) : null}
      </View>
      )}

      {compact ? null : (
        <Pressable
          onPress={() => router.push({ pathname: "/booking/[id]", params: { id: row.id } })}
          accessibilityRole="button"
          style={({ pressed }) => [s.open, pressed && s.openPressed]}
        >
          <Text style={s.openText}>Open booking</Text>
        </Pressable>
      )}
    </View>
  );
}

function Action({ icon, label, onPress }: { icon: ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [s.action, pressed && s.actionPressed]}
    >
      {icon}
      <Text style={s.actionText}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.ink,
    borderRadius: 16,
    padding: 18,
    gap: 14,
  },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  parked: { flexDirection: "row", alignItems: "center", gap: 6 },
  parkedText: { fontSize: 13, fontWeight: "700", letterSpacing: 1, color: MINT },
  ref: { fontSize: 12, fontWeight: "600", color: colors.onInkMuted, letterSpacing: 0.5 },
  gap2: { gap: 2 },
  name: { fontSize: 19, fontWeight: "700", color: colors.onInk },
  muted: { fontSize: 13, color: colors.onInkMuted },
  timeRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  remaining: { fontSize: 32, fontWeight: "700", color: colors.onInk, letterSpacing: -0.5 },
  range: { fontSize: 15, fontWeight: "600", color: colors.onInk },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.inkRaisedBorder, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3, backgroundColor: MINT },
  actions: { flexDirection: "row", gap: space.sm },
  remind: { fontSize: 12, color: colors.onInkMuted },
  action: {
    flex: 1,
    minHeight: 64,
    borderRadius: radius.sm + 2,
    backgroundColor: colors.inkRaised,
    borderWidth: 1,
    borderColor: colors.inkRaisedBorder,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  actionPressed: { backgroundColor: colors.inkSurface },
  actionText: { fontSize: 13, fontWeight: "600", color: colors.onInk },
  open: {
    minHeight: 48,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  openPressed: { opacity: 0.9 },
  openText: { fontSize: 15, fontWeight: "600", color: colors.ink },
});
