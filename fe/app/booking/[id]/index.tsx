import { Redirect, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, bookingsApi } from "@/api";
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
import { ParkedCard } from "@/features/bookings/ParkedCard";
import { useNow } from "@/features/bookings/useNow";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import {
  bookingListing,
  bookingRef,
  bookingWhen,
  dateTime,
  directionsUrl,
  isSpotBooking,
  phaseChip,
  timeLeft,
  unpaidExtension,
} from "@/lib/booking";
import { formatRupees } from "@/lib/money";
import { payForBooking } from "@/lib/payments";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space } from "@/theme";
import type { BookingDetail } from "@/types/api.types";

/**
 * One booking, everything about it, arranged by where it is in its life.
 *
 * The order is what a driver needs first at each stage: while parked, the
 * time left; before arriving, how to get in; after cancelling, where the
 * money is. A cancelled booking shows its refund here rather than on a
 * separate screen, so there is one place to come back to.
 */
export default function BookingDetailScreen() {
  const { token, isRestoring } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const now = useNow();

  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payNote, setPayNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !id) return;
    try {
      setBooking(await bookingsApi.get(token, id));
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? "This booking doesn't exist, or isn't yours."
          : "Could not load this booking."
      );
    }
  }, [token, id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const { run: pay, busy: paying } = useAsyncAction(async () => {
    if (!token || !booking) return;
    const outcome = await payForBooking({
      token,
      bookingId: booking.id,
      amount: booking.amount,
      method: "UPI",
    });

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
  const listing = booking ? bookingListing(booking) : null;

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader
          title={listing?.name ?? "Booking"}
          titleLines={2}
          sub={booking ? `Booking ${bookingRef(booking.id)}` : undefined}
          onBack={back}
        />

        <ScrollView contentContainerStyle={s.body}>
          {error ? <ErrorNotice message={error} /> : null}

          {!booking ? (
            error ? null : <ActivityIndicator color={colors.ink} style={s.loading} />
          ) : (
            <Body booking={booking} now={now} onPay={pay} paying={paying} payNote={payNote} />
          )}
        </ScrollView>
      </View>
    </PhoneFrame>
  );
}

function Body({
  booking,
  now,
  onPay,
  paying,
  payNote,
}: {
  booking: BookingDetail;
  now: number;
  onPay: () => void;
  paying: boolean;
  payNote: string | null;
}) {
  const listing = bookingListing(booking);
  const chip = phaseChip(booking);
  const spot = isSpotBooking(booking);
  const directions = directionsUrl(listing);
  const paid = booking.payment?.status === "CAPTURED";
  const extra = unpaidExtension(booking, now);
  const cancellable = booking.phase === "PENDING" || booking.phase === "UPCOMING";

  return (
    <>
      <View style={s.statusRow}>
        <StatusChip label={chip.label} tone={chip.tone} />
        <Text style={s.when}>{bookingWhen(booking)}</Text>
      </View>

      {booking.phase === "ACTIVE" ? <ParkedCard row={booking} now={now} compact /> : null}

      {booking.phase === "PENDING" ? (
        <View style={s.pending}>
          <Text style={s.pendingTitle}>
            {booking.holdExpiresAt
              ? `Held for you for ${timeLeft(booking.holdExpiresAt, now)} more`
              : "Waiting for payment"}
          </Text>
          <Text style={s.pendingBody}>
            Nobody else can book these hours while the hold lasts. Pay to turn it into a booking — until then it
            isn't one, and the host isn't expecting you.
          </Text>
          <Button label={`Pay ${formatRupees(booking.amount)}`} onPress={onPay} busy={paying} />
          {payNote ? <Text style={s.payNote}>{payNote}</Text> : null}
        </View>
      ) : null}

      {booking.phase === "EXPIRED" ? (
        <View style={s.notice}>
          <Text style={s.noticeTitle}>This hold expired before it was paid</Text>
          <Text style={s.noticeBody}>The time went back on sale. Search again to book it.</Text>
        </View>
      ) : null}

      {extra ? (
        <View style={s.pending}>
          <Text style={s.pendingTitle}>Extra time until {dateTime(extra.endsAt)} is waiting for payment</Text>
          <Button
            label={`Pay ${formatRupees(extra.amount)}`}
            variant="ghost"
            onPress={() => router.push({ pathname: "/booking/[id]/extend", params: { id: booking.id } })}
          />
        </View>
      ) : null}

      <Section title="STATUS">
        <Timeline steps={stepsFor(booking)} />
      </Section>

      {spot && booking.phase !== "CANCELLED" && booking.phase !== "EXPIRED" ? (
        <AccessCard instructions={booking.access?.accessInstructions ?? null} released={booking.access !== null} />
      ) : null}

      <Section title="DETAILS">
        <DataRow label="When" value={bookingWhen(booking)} />
        <DataRow label="Vehicle" value={booking.vehicleNumber} />
        <DataRow label="Parking" value={formatRupees(booking.amount)} />
        <DataRow
          label="Payment"
          value={paid ? `Paid ${formatRupees(booking.payment!.amount)}` : booking.phase === "CANCELLED" ? "—" : "Not paid"}
        />
        <DataRow label="Booking ID" value={bookingRef(booking.id)} />
      </Section>

      {listing && (listing.addressLine || listing.city) ? (
        <Section title="LOCATION">
          <Text style={s.address}>{[listing.addressLine, listing.city].filter(Boolean).join(", ")}</Text>
          {directions ? (
            <Button
              label="Get Directions"
              variant="ghost"
              icon={<NavigateIcon size={17} />}
              onPress={() => void Linking.openURL(directions)}
            />
          ) : null}
        </Section>
      ) : null}

      {!spot && booking.phase !== "CANCELLED" && booking.status === "CONFIRMED" ? (
        <Button
          label="Show gate pass"
          onPress={() => router.push({ pathname: "/pass/[id]", params: { id: booking.id } })}
        />
      ) : null}

      {cancellable ? (
        <Section title="CANCELLATION">
          <Text style={s.policy}>
            Free cancellation until an hour before your parking starts. After that, half the parking amount comes
            back until it starts. Nothing once it has started.
          </Text>
          <Button
            label="Cancel Booking"
            variant="danger"
            onPress={() => router.push({ pathname: "/booking/[id]/cancel", params: { id: booking.id } })}
          />
        </Section>
      ) : null}
    </>
  );
}

/** What has happened and what comes next, in the booking's own terms. */
function stepsFor(booking: BookingDetail): TimelineStep[] {
  const created = { title: "Booked", sub: dateTime(booking.createdAt), state: "done" as const };
  const start = booking.startsAt ?? bookingListing(booking)?.eventDate ?? null;
  const end = booking.effectiveEndsAt ?? booking.endsAt;
  const paid = booking.payment?.status === "CAPTURED";

  if (booking.phase === "CANCELLED") {
    const steps: TimelineStep[] = [
      { title: "Booking cancelled", sub: booking.cancelledAt ? dateTime(booking.cancelledAt) : null, state: "done" },
    ];
    if (booking.refund) {
      const refunded = booking.refund.status === "REFUNDED";
      steps.push(
        { title: `Refund of ${formatRupees(booking.refund.amount)} started`, sub: dateTime(booking.refund.createdAt), state: "done" },
        {
          title: refunded ? "Refund reached you" : "Refund reaches your account",
          sub: refunded
            ? booking.refund.processedAt
              ? dateTime(booking.refund.processedAt)
              : null
            : "Usually 5–7 working days, to the way you paid",
          state: refunded ? "done" : "next",
        }
      );
    } else {
      steps.push({ title: "Nothing to refund", sub: "No payment was taken for this booking.", state: "done" });
    }
    return steps;
  }

  const steps: TimelineStep[] = [
    created,
    {
      title: paid ? "Payment received" : "Payment",
      sub: paid ? formatRupees(booking.payment!.amount) : booking.phase === "EXPIRED" ? "Not paid in time" : "Waiting",
      state: paid ? "done" : booking.phase === "PENDING" ? "next" : "todo",
    },
  ];

  if (start) {
    const started = booking.phase === "ACTIVE" || booking.phase === "COMPLETED";
    steps.push({
      title: started ? "Parking started" : "Parking starts",
      sub: dateTime(start),
      state: started ? "done" : booking.phase === "UPCOMING" ? "next" : "todo",
    });
  }
  if (end) {
    const ended = booking.phase === "COMPLETED";
    steps.push({
      title: ended ? "Parking ended" : "Parking ends",
      sub: dateTime(end),
      state: ended ? "done" : booking.phase === "ACTIVE" ? "next" : "todo",
    });
  }
  return steps;
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
  statusRow: { flexDirection: "row", alignItems: "center", gap: space.md, flexWrap: "wrap" },
  when: { fontSize: 14, fontWeight: "600", color: colors.ink },
  section: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.sm,
  },
  sectionTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 1.2, color: colors.inkMuted, marginBottom: 4 },
  pending: {
    backgroundColor: colors.accentSurface,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.sm,
  },
  pendingTitle: { fontSize: 15, fontWeight: "700", color: colors.accentInk },
  pendingBody: { fontSize: 13, lineHeight: 19, color: colors.accentInk },
  payNote: { fontSize: 13, lineHeight: 19, color: colors.accentInk, fontWeight: "600" },
  notice: { backgroundColor: colors.canvas, borderRadius: radius.md, padding: space.lg, gap: 4 },
  noticeTitle: { fontSize: 15, fontWeight: "700", color: colors.ink },
  noticeBody: { fontSize: 13, lineHeight: 19, color: colors.inkMuted },
  address: { fontSize: 15, lineHeight: 22, color: colors.ink },
  policy: { fontSize: 14, lineHeight: 21, color: colors.inkMuted },
});
