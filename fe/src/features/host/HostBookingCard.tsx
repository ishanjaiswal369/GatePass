import { StyleSheet, Text, View } from "react-native";
import { DataRow, StatusChip } from "@/components/ui";
import { clockTime } from "@/lib/booking";
import { formatRupees } from "@/lib/money";
import { termRange, termSchedule } from "@/lib/monthly";
import { colors, radius, space } from "@/theme";
import type { HostBooking, PayoutState } from "@/types/api.types";

const PAYOUT_LABEL: Record<PayoutState, string> = {
  PENDING: "Pending",
  AVAILABLE: "Available",
  PAID_OUT: "Paid out",
  NONE: "No earning",
};

/** "Thu, 24 Sep · 10:00 AM – 5:00 PM" -- or "Today · …". */
export function stayLabel(b: Pick<HostBooking, "startsAt" | "endsAt">): string {
  if (!b.startsAt || !b.endsAt) return "";
  const start = new Date(b.startsAt);
  const today = new Date().toDateString() === start.toDateString();
  const dayText = today
    ? "Today"
    : start.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }).replace("Sept", "Sep");
  return `${dayText} · ${clockTime(b.startsAt)} – ${clockTime(b.endsAt)}`;
}

/**
 * One booking on a host's space, as the prototype's Host bookings card: when,
 * who (first name and initial), which vehicle, and what the host earns from
 * it. The plate is shown because the host checks it at the gate; nothing
 * else about the driver is.
 */
export function HostBookingCard({ booking, showSpace }: { booking: HostBooking; showSpace?: boolean }) {
  // A monthly reservation is either the whole term (the bookings list) or
  // one of its days (today, the calendar); a day never crosses midnight.
  const term = booking.monthly;
  const wholeTerm =
    !!term && !!booking.startsAt && !!booking.endsAt && new Date(booking.startsAt).toDateString() !== new Date(booking.endsAt).toDateString();
  const vehicle = [booking.vehicle.label, booking.vehicle.number].filter(Boolean).join(" · ");
  const earningLabel =
    Number(booking.earning) > 0
      ? `${formatRupees(booking.earning)} of ${formatRupees(booking.amount)}`
      : "No earning";

  return (
    <View style={s.card}>
      <View style={s.head}>
        <Text style={s.when}>{wholeTerm && term ? termRange(term.startDate, term.lastDate, term.months) : stayLabel(booking)}</Text>
        {term ? <StatusChip label="Monthly" tone="ink" /> : null}
        {booking.problem?.status === "OPEN" ? (
          <StatusChip label="Problem reported" tone="danger" />
        ) : booking.phase === "ACTIVE" ? (
          <StatusChip label="Parked now" tone="success" />
        ) : booking.isNew && booking.phase === "UPCOMING" ? (
          <StatusChip label="New booking" tone={term ? "success" : "ink"} />
        ) : null}
      </View>
      {term ? <Text style={s.term}>{wholeTerm ? termSchedule(term) : "Monthly reservation"}</Text> : null}
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
  term: { fontSize: 13, fontWeight: "600", color: colors.ink, marginBottom: 2 },
  space: { fontSize: 13, color: colors.inkMuted, marginBottom: 2 },
  state: { fontSize: 12, color: colors.inkMuted, marginTop: 4 },
});
