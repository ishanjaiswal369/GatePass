import { StyleSheet, Text, View } from "react-native";
import { DataRow, StatusChip } from "@/components/ui";
import { clockTime } from "@/lib/booking";
import { formatRupees } from "@/lib/money";
import { colors, radius, space } from "@/theme";
import type { HostBooking, PayoutState } from "@/types/api.types";

const PAYOUT_LABEL: Record<PayoutState, string> = {
  PENDING: "Pending",
  AVAILABLE: "Available",
  PAID_OUT: "Paid out",
  NONE: "No earning",
};

function dayText(date: Date): string {
  return new Date().toDateString() === date.toDateString()
    ? "Today"
    : date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }).replace("Sept", "Sep");
}

/**
 * "Thu, 24 Sep · 10:00 AM – 5:00 PM" -- or "Today · …". A stay that runs
 * past midnight names both days: "Tue, 29 Sep 9:00 AM – Fri, 2 Oct 9:00 AM".
 */
export function stayLabel(b: Pick<HostBooking, "startsAt" | "endsAt">): string {
  if (!b.startsAt || !b.endsAt) return "";
  const start = new Date(b.startsAt);
  const end = new Date(b.endsAt);
  return start.toDateString() === end.toDateString()
    ? `${dayText(start)} · ${clockTime(b.startsAt)} – ${clockTime(b.endsAt)}`
    : `${dayText(start)} ${clockTime(b.startsAt)} – ${dayText(end)} ${clockTime(b.endsAt)}`;
}

/**
 * One booking on a host's space, as the prototype's Host bookings card: when,
 * who (first name and initial), which vehicle, and what the host earns from
 * it. The plate is shown because the host checks it at the gate; nothing
 * else about the driver is.
 */
export function HostBookingCard({ booking, showSpace }: { booking: HostBooking; showSpace?: boolean }) {
  const vehicle = [booking.vehicle.label, booking.vehicle.number].filter(Boolean).join(" · ");
  const earningLabel =
    Number(booking.earning) > 0
      ? `${formatRupees(booking.earning)} of ${formatRupees(booking.amount)}`
      : "No earning";

  return (
    <View style={s.card}>
      <View style={s.head}>
        <Text style={s.when}>{stayLabel(booking)}</Text>
        {booking.problem?.status === "OPEN" ? (
          <StatusChip label="Problem reported" tone="danger" />
        ) : booking.phase === "ACTIVE" ? (
          <StatusChip label="Parked now" tone="success" />
        ) : booking.isNew && booking.phase === "UPCOMING" ? (
          <StatusChip label="New booking" tone="ink" />
        ) : null}
      </View>
      {showSpace && booking.listing ? <Text style={s.space}>{booking.listing.name}</Text> : null}
      <DataRow label="Customer" value={booking.driver} />
      <DataRow label="Vehicle" value={vehicle} />
      <DataRow label="You earn" value={earningLabel} />
      {booking.phase === "COMPLETED" || booking.phase === "CANCELLED" ? (
        <Text style={s.state}>
          {booking.phase === "CANCELLED"
            ? Number(booking.earning) > 0
              ? `Cancelled late · you keep your share of what wasn't refunded · ${PAYOUT_LABEL[booking.payout]}`
              : "Cancelled by the driver within the free-cancellation window."
            : PAYOUT_LABEL[booking.payout]}
        </Text>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.lg, gap: 2 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm, marginBottom: 4 },
  when: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.ink },
  space: { fontSize: 13, color: colors.inkMuted, marginBottom: 2 },
  state: { fontSize: 12, color: colors.inkMuted, marginTop: 4 },
});
