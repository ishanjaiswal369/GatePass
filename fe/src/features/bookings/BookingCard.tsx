import { router } from "expo-router";
import type { ReactNode } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import {
  Button,
  CalendarIcon,
  CarIcon,
  ClockIcon,
  NavigateIcon,
  PinIcon,
  StatusChip,
} from "@/components/ui";
import {
  bookingListing,
  bookingWhen,
  directionsUrl,
  isSpotBooking,
  phaseChip,
  timeLeft,
} from "@/lib/booking";
import { formatRupees } from "@/lib/money";
import { colors, HIT_SLOP_MIN, radius, space } from "@/theme";
import type { BookingRow } from "@/types/api.types";

const GREEN = "#166534";

/**
 * One booking in the Bookings tab.
 *
 * What it offers depends on where the booking is in its life: directions
 * before a confirmed stay, a way to finish paying on a hold, the refund on a
 * cancellation. Everything else is on the detail screen, one tap away.
 */
export function BookingCard({ row, now }: { row: BookingRow; now: number }) {
  const listing = bookingListing(row);
  const chip = phaseChip(row);
  const paid = row.payment?.status === "CAPTURED" ? row.payment.amount : row.amount;
  const directions =
    row.phase === "UPCOMING" && isSpotBooking(row) ? directionsUrl(listing) : null;
  const where =
    [listing?.addressLine, listing?.city].filter(Boolean).join(", ") || listing?.venueName;

  const open = () => router.push({ pathname: "/booking/[id]", params: { id: row.id } });

  return (
    <View style={s.card}>
      <View style={s.head}>
        <Text style={s.name} numberOfLines={2}>
          {listing?.name ?? "Parking"}
        </Text>
        <StatusChip label={chip.label} tone={chip.tone} />
      </View>

      <View style={s.lines}>
        {where ? <Line icon={<PinIcon size={15} color={colors.inkMuted} />} text={where} muted /> : null}
        <Line icon={<CalendarIcon size={15} color={colors.inkMuted} />} text={bookingWhen(row)} />
        <Line icon={<CarIcon size={15} color={colors.inkMuted} />} text={row.vehicleNumber} muted />
        {row.phase === "PENDING" && row.holdExpiresAt ? (
          <Line
            icon={<ClockIcon size={15} color={colors.accentInk} />}
            text={`Held for ${timeLeft(row.holdExpiresAt, now)} more. Pay to confirm.`}
            tone="warning"
          />
        ) : null}
        {row.refund ? (
          <Line
            icon={<ClockIcon size={15} color={GREEN} />}
            text={
              row.refund.status === "REFUNDED"
                ? `Refunded ${formatRupees(row.refund.amount)}`
                : `Refund of ${formatRupees(row.refund.amount)} on its way`
            }
            tone="success"
          />
        ) : null}
      </View>

      <View style={s.foot}>
        <Text style={s.amount}>{formatRupees(paid)}</Text>
        <View style={s.actions}>
          {directions ? (
            <Pressable
              onPress={() => void Linking.openURL(directions)}
              accessibilityRole="link"
              accessibilityLabel="Get directions"
              style={({ pressed }) => [s.iconButton, pressed && s.pressed]}
            >
              <NavigateIcon />
            </Pressable>
          ) : null}
          <View style={s.cta}>
            <Button
              label={row.phase === "PENDING" ? "Complete Payment" : "View Booking"}
              variant={row.phase === "PENDING" || row.phase === "UPCOMING" ? "primary" : "ghost"}
              onPress={open}
            />
          </View>
        </View>
      </View>
    </View>
  );
}

function Line({
  icon,
  text,
  muted,
  tone,
}: {
  icon: ReactNode;
  text: string;
  muted?: boolean;
  tone?: "warning" | "success";
}) {
  return (
    <View style={s.line}>
      {icon}
      <Text
        style={[s.lineText, muted && s.muted, tone === "warning" && s.warning, tone === "success" && s.success]}
        numberOfLines={2}
      >
        {text}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.md,
    backgroundColor: colors.surface,
  },
  head: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space.sm },
  name: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.ink },
  lines: { gap: 6 },
  line: { flexDirection: "row", alignItems: "center", gap: space.sm },
  lineText: { flex: 1, fontSize: 14, color: colors.ink },
  muted: { color: "#374151" },
  warning: { color: colors.accentInk, fontWeight: "600" },
  success: { color: GREEN, fontWeight: "600" },
  foot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space.md,
  },
  amount: { fontSize: 17, fontWeight: "700", color: colors.ink },
  actions: { flexDirection: "row", alignItems: "center", gap: space.sm },
  iconButton: {
    width: HIT_SLOP_MIN,
    height: HIT_SLOP_MIN,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { backgroundColor: colors.canvas },
  cta: { minWidth: 150 },
});
