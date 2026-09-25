import { router } from "expo-router";
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button, CalendarIcon, CarIcon, ClockIcon, PinIcon, StatusChip } from "@/components/ui";
import { timeLeft } from "@/lib/booking";
import { formatRupees } from "@/lib/money";
import { monthlyChip, monthlyTotal, termRange, termSchedule } from "@/lib/monthly";
import { colors, radius, space } from "@/theme";
import type { MonthlyReservation } from "@/types/api.types";

const GREEN = "#166534";

/**
 * A monthly reservation in the Bookings tab, as the prototype draws it: a
 * Monthly badge beside the status, the term, the days and hours, the vehicle
 * and what was paid for all of it.
 */
export function MonthlyCard({ row, now }: { row: MonthlyReservation; now: number }) {
  const chip = monthlyChip(row.phase);
  const where = [row.listing.addressLine, row.listing.city].filter(Boolean).join(", ");
  const paid = row.payment?.status === "CAPTURED" ? row.payment.amount : monthlyTotal(row);
  const open = () => router.push({ pathname: "/monthly/[id]", params: { id: row.id } });

  return (
    <View style={s.card}>
      <View style={s.head}>
        <Text style={s.name} numberOfLines={2}>
          {row.listing.name}
        </Text>
        <View style={s.chips}>
          <StatusChip label="Monthly" tone="ink" />
          <StatusChip label={chip.label} tone={chip.tone} />
        </View>
      </View>

      <View style={s.lines}>
        {where ? <Line icon={<PinIcon size={15} color={colors.inkMuted} />} text={where} muted /> : null}
        <Line icon={<CalendarIcon size={15} color={colors.inkMuted} />} text={termRange(row.startDate, row.lastDate, row.months)} />
        <Line icon={<ClockIcon size={15} color={colors.inkMuted} />} text={termSchedule(row)} />
        <Line icon={<CarIcon size={15} color={colors.inkMuted} />} text={row.vehicleNumber} muted />
        {row.phase === "PENDING" && row.holdExpiresAt ? (
          <Line
            icon={<ClockIcon size={15} color={colors.accentInk} />}
            text={`Held for ${timeLeft(row.holdExpiresAt, now)} more. Pay to confirm.`}
            tone="warning"
          />
        ) : null}
        {row.refund && Number(row.refund.amount) > 0 ? (
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
        <View style={s.cta}>
          <Button
            label={row.phase === "PENDING" ? "Complete Payment" : "View Booking"}
            variant={row.phase === "PENDING" || row.phase === "UPCOMING" ? "primary" : "ghost"}
            onPress={open}
          />
        </View>
      </View>
    </View>
  );
}

function Line({ icon, text, muted, tone }: { icon: ReactNode; text: string; muted?: boolean; tone?: "warning" | "success" }) {
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
  head: { gap: space.sm },
  chips: { flexDirection: "row", gap: 6 },
  name: { fontSize: 16, fontWeight: "700", color: colors.ink },
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
  cta: { minWidth: 150 },
});
