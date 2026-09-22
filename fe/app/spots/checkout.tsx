import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, bookingsApi, profileApi, spotsApi } from "@/api";
import {
  Button,
  DataRow,
  ErrorNotice,
  PhoneFrame,
  PickerField,
  RestoringScreen,
  SectionHeader,
  type SheetOption,
} from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { holdMinutesLeft } from "@/lib/booking";
import { keyFor, type Attempt } from "@/lib/idempotency";
import { formatRupees, hourlyAmount } from "@/lib/money";
import {
  MIN_STAY_MINUTES,
  describeRange,
  formatDuration,
} from "@/lib/searchCriteria";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space, type } from "@/theme";
import type {
  BookingRow,
  PublicSpot,
  Vehicle,
  VehicleType,
} from "@/types/api.types";

const VEHICLE_LABELS: Record<VehicleType, string> = {
  CAR: "Car",
  BIKE: "Bike",
  OTHER: "Other",
};

/**
 * Taking a host's spot for a stretch of hours.
 *
 * The hours are not editable here. They came from a search that has already
 * been matched against this spot's opening times, and letting them be nudged
 * on the last screen would mean quietly asking the server a question the
 * driver never saw answered. Changing them means going back to the search,
 * which is one tap and is honest about what it does.
 *
 * What this screen does own: which saved vehicle, because that is what picks
 * the rate, and the price that falls out of it. The price shown is an
 * estimate computed the way the server computes the real one; once a booking
 * exists, its own amount is what gets shown.
 */
export default function SpotCheckoutScreen() {
  const { token, isRestoring } = useSession();
  const params = useLocalSearchParams<{ id: string; from: string; to: string }>();

  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const range = readRange(params.from, params.to);

  const [spot, setSpot] = useState<PublicSpot | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** Set once the booking exists. From here the screen reports, not asks. */
  const [booked, setBooked] = useState<BookingRow | null>(null);

  /**
   * The key for this attempt. Held against what is being booked rather than
   * minted per tap, so a retry after a dropped response resolves to the
   * booking the first one made, while changing the vehicle earns a new key
   * instead of replaying the booking being changed.
   */
  const attempt = useRef<Attempt | null>(null);

  const load = useCallback(async () => {
    if (!token || !id) return;

    try {
      const [found, { vehicles: saved }] = await Promise.all([
        spotsApi.getById(token, id),
        profileApi.listVehicles(token),
      ]);

      setSpot(found);
      setVehicles(saved);
      setLoadError(null);
    } catch (err) {
      setVehicles([]);
      setLoadError(
        err instanceof ApiError && err.status === 404
          ? "This spot is no longer available."
          : "Could not load this spot."
      );
    }
  }, [token, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const rateFor = (vehicleType: VehicleType) =>
    spot?.pricing.find((row) => row.vehicleType === vehicleType) ?? null;

  /**
   * Preselected once both halves have arrived: the default vehicle if this
   * spot takes it, otherwise the first one it does. A vehicle with no rate
   * here is still offered -- it belongs to the driver, and hiding it is more
   * confusing than saying why it will not do.
   */
  useEffect(() => {
    if (!spot || !vehicles || vehicleId !== null || vehicles.length === 0) return;

    const priced = vehicles.filter((vehicle) =>
      spot.pricing.some((row) => row.vehicleType === vehicle.vehicleType)
    );

    const pick =
      priced.find((vehicle) => vehicle.isDefault) ??
      priced[0] ??
      vehicles.find((vehicle) => vehicle.isDefault) ??
      vehicles[0];

    setVehicleId(pick.id);
  }, [spot, vehicles, vehicleId]);

  const vehicle = vehicles?.find((row) => row.id === vehicleId) ?? null;
  const rate = vehicle ? rateFor(vehicle.vehicleType) : null;

  const { run: book, busy, error } = useAsyncAction(async () => {
    if (!token || !id || !vehicle || !range) return;

    const startsAt = range.from.toISOString();
    const endsAt = range.to.toISOString();

    setBooked(
      await bookingsApi.createSpotBooking(token, {
        listingId: id,
        vehicleType: vehicle.vehicleType,
        vehicleNumber: vehicle.vehicleNumber,
        startsAt,
        endsAt,
        idempotencyKey: keyFor(
          attempt,
          `${id}|${vehicle.id}|${startsAt}|${endsAt}`
        ),
      })
    );
  });

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;
  // Neither is recoverable here, and inventing a spot or a stay would book
  // something nobody asked for.
  if (!id || !range) return <Redirect href="/home" />;

  const back = () =>
    router.canGoBack() ? router.back() : router.replace("/home");

  if (booked) {
    return <HeldBooking booking={booked} spotName={spot?.name ?? "Parking spot"} />;
  }

  const estimate = rate ? hourlyAmount(rate.pricePerHour, range.minutes) : null;

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <SectionHeader title="Review your booking" sub={spot?.name} onBack={back} />

        <ScrollView contentContainerStyle={s.body}>
          {loadError ? <ErrorNotice message={loadError} /> : null}

          {!spot || !vehicles ? (
            loadError ? null : (
              <ActivityIndicator color={colors.ink} style={s.loading} />
            )
          ) : (
            <>
              <View style={s.card}>
                <Text style={s.cardHeading}>Your stay</Text>
                <DataRow label="When" value={describeRange(range.from, range.to)} />
                <DataRow label="For" value={formatDuration(range.minutes)} />
                <DataRow
                  label="Where"
                  value={
                    [spot.addressLine, spot.city].filter(Boolean).join(", ") ||
                    spot.venueName
                  }
                />
              </View>

              {vehicles.length === 0 ? (
                <View style={s.notice}>
                  <Text style={s.noticeTitle}>No vehicle saved</Text>
                  <Text style={s.noticeBody}>
                    A booking names the vehicle that will be in the space. Save
                    one and come back; these hours are not held until you do.
                  </Text>
                  <Button
                    label="Add a vehicle"
                    variant="ghost"
                    onPress={() => router.push("/account/vehicles")}
                  />
                </View>
              ) : (
                <PickerField
                  label="Vehicle"
                  title="Which vehicle"
                  value={vehicleId ?? vehicles[0].id}
                  options={vehicles.map(
                    (row): SheetOption<string> => ({
                      value: row.id,
                      label: row.vehicleNumber,
                      sub: describeVehicle(row, rateFor(row.vehicleType)),
                    })
                  )}
                  onChange={setVehicleId}
                />
              )}

              {vehicle && !rate ? (
                <View style={s.notice}>
                  <Text style={s.noticeTitle}>
                    This spot does not take that vehicle
                  </Text>
                  <Text style={s.noticeBody}>
                    The host prices {pricedKinds(spot)} parking only. Pick
                    another vehicle, or find a spot that takes this one.
                  </Text>
                </View>
              ) : null}

              {rate && estimate !== null ? (
                <View style={s.card}>
                  <Text style={s.cardHeading}>What it costs</Text>
                  <DataRow
                    label="Rate"
                    value={`${formatRupees(rate.pricePerHour)} per hour`}
                  />
                  <DataRow label="Time" value={formatDuration(range.minutes)} />
                  <View style={s.totalRow}>
                    <Text style={s.totalLabel}>Total</Text>
                    <Text style={s.total}>{formatRupees(estimate)}</Text>
                  </View>
                </View>
              ) : null}

              {error ? <ErrorNotice message={error} /> : null}

              <Button
                label="Hold these hours"
                size="lg"
                onPress={book}
                busy={busy}
                disabled={!rate}
              />

              <Text style={s.fine}>
                Holding costs nothing and confirms nothing. The hours stay
                yours for 15 minutes while payment is arranged, and payment is
                not live yet, so this hold will lapse.
              </Text>

              <Button label="Change times" variant="ghost" onPress={back} />
            </>
          )}
        </ScrollView>
      </View>
    </PhoneFrame>
  );
}

/**
 * What a hold actually is, said plainly.
 *
 * A PENDING booking is not a pass and no gate will take it. Calling this
 * "Booked" would be a lie the driver only discovers at the spot, so the screen
 * names the state, the deadline, and the fact that nothing can meet it yet.
 */
function HeldBooking({
  booking,
  spotName,
}: {
  booking: BookingRow;
  spotName: string;
}) {
  const left = holdMinutesLeft(booking);

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <SectionHeader title="Held for you" sub={spotName} />

        <ScrollView contentContainerStyle={s.body}>
          <View style={s.card}>
            <Text style={s.cardHeading}>What you have</Text>
            <DataRow
              label="When"
              value={
                booking.startsAt && booking.endsAt
                  ? describeRange(
                      new Date(booking.startsAt),
                      new Date(booking.endsAt)
                    )
                  : null
              }
            />
            <DataRow label="Vehicle" value={booking.vehicleNumber} />
            <DataRow label="Amount" value={formatRupees(booking.amount)} />
            <DataRow label="Status" value={booking.status} />
          </View>

          <View style={s.notice}>
            <Text style={s.noticeTitle}>
              {left === null
                ? "This is not a confirmed booking"
                : left === 0
                  ? "This hold has lapsed"
                  : `About ${left} ${left === 1 ? "minute" : "minutes"} left on this hold`}
            </Text>
            <Text style={s.noticeBody}>
              Nobody else can take these hours while the hold stands, but it is
              not a pass and the host is not expecting you. Paying is what turns
              a hold into a booking, and payments are not live yet, so this one
              will run out and the hours will go back on sale.
            </Text>
          </View>

          <Button label="See my bookings" onPress={() => router.replace("/bookings")} />
          <Button
            label="Back to search"
            variant="ghost"
            onPress={() => router.replace("/home")}
          />
        </ScrollView>
      </View>
    </PhoneFrame>
  );
}

/** "car", "car and bike" -- what the host actually priced. */
function pricedKinds(spot: PublicSpot): string {
  const kinds = spot.pricing.map((row) =>
    VEHICLE_LABELS[row.vehicleType].toLowerCase()
  );

  if (kinds.length === 0) return "no";
  if (kinds.length === 1) return kinds[0];

  return `${kinds.slice(0, -1).join(", ")} and ${kinds.at(-1)}`;
}

function describeVehicle(
  vehicle: Vehicle,
  rate: { pricePerHour: string } | null
): string {
  const kind = VEHICLE_LABELS[vehicle.vehicleType];
  const price = rate
    ? `${formatRupees(rate.pricePerHour)} per hour`
    : "not taken at this spot";

  return `${kind} · ${price}`;
}

/**
 * The stay these params describe, or null.
 *
 * Null rather than a best guess: they come off a URL, so they can be stale,
 * truncated or hand-edited, and a checkout that quietly books a different
 * stretch of time than the one asked for is the worst way to be wrong.
 */
function readRange(
  from: string | string[] | undefined,
  to: string | string[] | undefined
): { from: Date; to: Date; minutes: number } | null {
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const start = Date.parse(first(from) ?? "");
  const end = Date.parse(first(to) ?? "");

  if (Number.isNaN(start) || Number.isNaN(end)) return null;

  const minutes = Math.round((end - start) / 60_000);
  if (minutes < MIN_STAY_MINUTES) return null;

  return { from: new Date(start), to: new Date(end), minutes };
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  body: { padding: 20, paddingTop: space.lg, gap: space.lg },
  loading: { paddingVertical: space.xxl },
  card: {
    gap: space.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
  },
  cardHeading: {
    ...type.label,
    color: colors.inkMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: space.xs,
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingTop: space.md,
  },
  totalLabel: { ...type.body, fontWeight: "600", color: colors.ink },
  total: { fontSize: 22, fontWeight: "700", color: colors.ink },
  notice: {
    gap: space.sm,
    backgroundColor: colors.accentSurface,
    borderWidth: 1,
    borderColor: colors.devBorder,
    borderRadius: radius.md,
    padding: space.lg,
  },
  noticeTitle: { ...type.label, color: colors.accentInk, fontSize: 15 },
  noticeBody: { fontSize: 13, lineHeight: 19, color: colors.accentInk },
  fine: { ...type.caption, lineHeight: 18, color: colors.inkMuted },
});
