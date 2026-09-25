import { Redirect, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, monthlyApi } from "@/api";
import {
  Button,
  DataRow,
  ErrorNotice,
  NavigateIcon,
  PhoneFrame,
  RestoringScreen,
  ScreenHeader,
  StatusChip,
  Timeline,
  type TimelineStep,
} from "@/components/ui";
import { AccessCard } from "@/features/bookings/AccessCard";
import { useNow } from "@/features/bookings/useNow";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { dateTime, timeLeft } from "@/lib/booking";
import { formatRupees } from "@/lib/money";
import { monthlyChip, monthlyTotal, termDay, termRange, termSchedule } from "@/lib/monthly";
import { payForMonthly } from "@/lib/payments";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space } from "@/theme";
import type { MonthlyReservation } from "@/types/api.types";

/**
 * One monthly reservation (Phase 6): the term, how to get in once it's paid,
 * what was paid, and the way out.
 *
 * There is no gate pass or "parked now" state for a term: the space is the
 * driver's for the chosen days and hours, and the access instructions are
 * what they use each time. The refund on a cancellation shows here, so this
 * is the one place to come back to.
 */
export default function MonthlyDetailScreen() {
  const { token, isRestoring } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const now = useNow();

  const [row, setRow] = useState<MonthlyReservation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payNote, setPayNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !id) return;
    try {
      setRow(await monthlyApi.get(token, id));
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? "This reservation doesn't exist, or isn't yours."
          : "Could not load this reservation."
      );
    }
  }, [token, id]);

  // On focus: coming back from cancelling has to show the refund.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const { run: pay, busy: paying } = useAsyncAction(async () => {
    if (!token || !row) return;
    const outcome = await payForMonthly({ token, reservationId: row.id, amount: monthlyTotal(row), method: "UPI" });
    if (outcome.status === "PAID") {
      setPayNote(null);
      await load();
    } else if (outcome.status === "FAILED") {
      setPayNote(`Payment couldn't be completed. ${outcome.message}`);
    } else if (outcome.status === "NOT_CONFIGURED") {
      setPayNote("Online payment isn't switched on in this version yet, so this hold can't be paid from the app.");
    }
  });

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  const back = () => (router.canGoBack() ? router.back() : router.replace("/bookings"));

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader
          title={row?.listing.name ?? "Monthly parking"}
          titleLines={2}
          sub={row ? `Monthly · ${row.ref}` : undefined}
          onBack={back}
        />

        <ScrollView contentContainerStyle={s.body}>
          {error ? <ErrorNotice message={error} /> : null}

          {!row ? (
            error ? null : <ActivityIndicator color={colors.ink} style={s.loading} />
          ) : (
            <Body row={row} now={now} onPay={pay} paying={paying} payNote={payNote} />
          )}
        </ScrollView>
      </View>
    </PhoneFrame>
  );
}

function Body({
  row,
  now,
  onPay,
  paying,
  payNote,
}: {
  row: MonthlyReservation;
  now: number;
  onPay: () => void;
  paying: boolean;
  payNote: string | null;
}) {
  const chip = monthlyChip(row.phase);
  const paid = row.payment?.status === "CAPTURED";
  const live = row.phase !== "CANCELLED" && row.phase !== "EXPIRED";
  const cancellable = row.phase === "PENDING" || row.phase === "UPCOMING" || row.phase === "ACTIVE";
  const { listing } = row;
  const destination =
    listing.latitude && listing.longitude
      ? `${listing.latitude},${listing.longitude}`
      : [listing.addressLine, listing.city].filter(Boolean).join(", ");
  const address = [listing.addressLine, listing.city].filter(Boolean).join(", ");

  return (
    <>
      <View style={s.statusRow}>
        <StatusChip label="Monthly" tone="ink" />
        <StatusChip label={chip.label} tone={chip.tone} />
      </View>

      <View style={s.term}>
        <Text style={s.termRange}>{termRange(row.startDate, row.lastDate, row.months)}</Text>
        <Text style={s.termSchedule}>{termSchedule(row)}</Text>
        <Text style={s.muted}>{row.vehicleNumber}</Text>
      </View>

      {row.phase === "PENDING" ? (
        <View style={s.pending}>
          <Text style={s.pendingTitle}>
            {row.holdExpiresAt ? `Held for you for ${timeLeft(row.holdExpiresAt, now)} more` : "Waiting for payment"}
          </Text>
          <Text style={s.pendingBody}>
            Nobody else can take these days and hours while the hold lasts. Pay to turn it into a reservation — until
            then it isn't one, and the host isn't expecting you.
          </Text>
          <Button label={`Pay ${formatRupees(monthlyTotal(row))}`} onPress={onPay} busy={paying} />
          {payNote ? <Text style={s.payNote}>{payNote}</Text> : null}
        </View>
      ) : null}

      {row.phase === "EXPIRED" ? (
        <View style={s.notice}>
          <Text style={s.noticeTitle}>This hold expired before it was paid</Text>
          <Text style={s.noticeBody}>The days went back on sale. Search again to reserve them.</Text>
        </View>
      ) : null}

      {row.phase === "UPCOMING" || row.phase === "ACTIVE" ? (
        <View style={s.notice}>
          <Text style={s.noticeTitle}>Doesn't renew automatically</Text>
          <Text style={s.noticeBody}>
            Your last day is {termDay(row.lastDate)}. We'll remind you 7 days before it ends.
          </Text>
        </View>
      ) : null}

      <Section title="STATUS">
        <Timeline steps={stepsFor(row)} />
      </Section>

      {live ? (
        <AccessCard
          instructions={row.access?.accessInstructions ?? null}
          bayNumber={row.access?.bayNumber}
          parkingMarker={row.access?.parkingMarker}
          released={!!row.access}
          noun="reservation"
        />
      ) : null}

      {live && listing.entryPoint ? (
        <Section title="ENTRY POINT">
          <Text style={s.address}>{listing.entryPoint}</Text>
        </Section>
      ) : null}

      <Section title="DETAILS">
        <DataRow label="Term" value={termRange(row.startDate, row.lastDate, row.months)} />
        <DataRow label="Days and hours" value={termSchedule(row)} />
        <DataRow label="Vehicle" value={row.vehicleNumber} />
        <DataRow label={`Monthly parking · ${formatRupees(row.pricePerMonth)} × ${row.months}`} value={formatRupees(row.amount)} />
        <DataRow label="Platform fee" value={formatRupees(row.platformFee)} />
        <DataRow label="GST on platform fee" value={formatRupees(row.taxAmount)} />
        <DataRow label="Total" value={formatRupees(monthlyTotal(row))} />
        <DataRow
          label="Payment"
          value={paid ? `Paid ${formatRupees(row.payment!.amount)}` : row.phase === "CANCELLED" ? "—" : "Not paid"}
        />
        <DataRow label="Reservation ID" value={row.ref} />
      </Section>

      {address ? (
        <Section title="LOCATION">
          <Text style={s.address}>{address}</Text>
          <Button
            label="Get Directions"
            variant="ghost"
            icon={<NavigateIcon size={17} />}
            onPress={() =>
              void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`)
            }
          />
        </Section>
      ) : null}

      {cancellable ? (
        <Section title="CANCELLATION">
          <Text style={s.policy}>
            Cancel before {termDay(row.startDate)} for a full refund. After it starts, the parking for whole months not
            yet begun comes back; the platform fee doesn't.
          </Text>
          <Button
            label="Cancel Reservation"
            variant="danger"
            onPress={() => router.push({ pathname: "/monthly/[id]/cancel", params: { id: row.id } })}
          />
        </Section>
      ) : null}
    </>
  );
}

/** What has happened and what comes next, in the term's own terms. */
function stepsFor(row: MonthlyReservation): TimelineStep[] {
  const paid = row.payment?.status === "CAPTURED";

  if (row.phase === "CANCELLED") {
    const steps: TimelineStep[] = [
      { title: "Reservation cancelled", sub: row.cancelledAt ? dateTime(row.cancelledAt) : null, state: "done" },
    ];
    if (row.refund && Number(row.refund.amount) > 0) {
      const refunded = row.refund.status === "REFUNDED";
      steps.push(
        { title: `Refund of ${formatRupees(row.refund.amount)} started`, sub: dateTime(row.refund.createdAt), state: "done" },
        {
          title: refunded ? "Refund reached you" : "Refund reaches your account",
          sub: refunded ? null : "Usually 5–7 working days, to the way you paid",
          state: refunded ? "done" : "next",
        }
      );
    } else {
      steps.push({ title: "Nothing to refund", sub: paid ? null : "No payment was taken for this reservation.", state: "done" });
    }
    return steps;
  }

  const started = row.phase === "ACTIVE" || row.phase === "COMPLETED";
  return [
    { title: "Reserved", sub: dateTime(row.createdAt), state: "done" },
    {
      title: paid ? "Payment received" : "Payment",
      sub: paid ? formatRupees(row.payment!.amount) : row.phase === "EXPIRED" ? "Not paid in time" : "Waiting",
      state: paid ? "done" : row.phase === "PENDING" ? "next" : "todo",
    },
    {
      title: started ? "Term started" : "Term starts",
      sub: termDay(row.startDate),
      state: started ? "done" : row.phase === "UPCOMING" ? "next" : "todo",
    },
    {
      title: row.phase === "COMPLETED" ? "Term ended" : "Last day",
      sub: termDay(row.lastDate),
      state: row.phase === "COMPLETED" ? "done" : row.phase === "ACTIVE" ? "next" : "todo",
    },
  ];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  body: { padding: 20, gap: space.lg, paddingBottom: 32 },
  loading: { paddingVertical: space.xxl },
  statusRow: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  term: { gap: 4 },
  termRange: { fontSize: 18, fontWeight: "700", color: colors.ink },
  termSchedule: { fontSize: 15, fontWeight: "600", color: colors.ink },
  muted: { fontSize: 14, color: colors.inkMuted },
  section: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.sm,
  },
  sectionTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 1.2, color: colors.inkMuted, marginBottom: 4 },
  pending: { backgroundColor: colors.accentSurface, borderRadius: radius.md, padding: space.lg, gap: space.sm },
  pendingTitle: { fontSize: 15, fontWeight: "700", color: colors.accentInk },
  pendingBody: { fontSize: 13, lineHeight: 19, color: colors.accentInk },
  payNote: { fontSize: 13, lineHeight: 19, color: colors.accentInk, fontWeight: "600" },
  notice: { backgroundColor: colors.canvas, borderRadius: radius.md, padding: space.lg, gap: 4 },
  noticeTitle: { fontSize: 15, fontWeight: "700", color: colors.ink },
  noticeBody: { fontSize: 13, lineHeight: 19, color: colors.inkMuted },
  address: { fontSize: 15, lineHeight: 22, color: colors.ink },
  policy: { fontSize: 14, lineHeight: 21, color: colors.inkMuted },
});
