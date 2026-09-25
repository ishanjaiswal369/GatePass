import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, monthlyApi, profileApi, spotsApi } from "@/api";
import {
  Button,
  CalendarIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DataRow,
  ErrorNotice,
  HeartIcon,
  KeyIcon,
  LockIcon,
  PhoneFrame,
  PinIcon,
  RatingBadge,
  RestoringScreen,
  ShieldIcon,
  SpotCover,
  StarIcon,
} from "@/components/ui";
import type { VehicleType } from "@/constants/enums";
import { reviewCountLabel } from "@/features/reviews/labels";
import { RatingSummaryView } from "@/features/reviews/RatingSummaryView";
import { ReviewItem } from "@/features/reviews/ReviewItem";
import { useStaticMap } from "@/hooks/useStaticMap";
import { useScreenInsets } from "@/hooks/useScreenInsets";
import { distanceKm, distanceLabel } from "@/lib/geo";
import { groupByHours } from "@/lib/hours";
import { durationText } from "@/lib/listingRules";
import { formatRupees, rateLine } from "@/lib/money";
import { monthsLabel, termRange, termSchedule } from "@/lib/monthly";
import { describeCriteria, fromParams, toParams, type HourlyCriteria, type MonthlyCriteria } from "@/lib/searchCriteria";
import {
  AMENITY_LABELS,
  ENTRY_METHOD_LABELS,
  feetLabel,
  heightLabel,
  spaceLabel,
  VEHICLE_LABELS,
  VEHICLE_SIZE_LABELS,
} from "@/lib/spotLabels";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space } from "@/theme";
import type { MonthlyQuote, PublicSpot, StayQuote } from "@/types/api.types";

/**
 * A host's spot, for a driver deciding whether to take it.
 *
 * Photo first, then what the stay costs, what the space is, and how to get
 * in -- the part a driver has to act on physically, drawn heaviest. The entry
 * point and hours are public; the detailed instructions (gate code, bay
 * number) arrive with a paid booking, and the screen says so rather than
 * leaving a blank.
 *
 * The price in the bar is the server's quote for this exact stay and vehicle,
 * so it is the amount the checkout will charge.
 */
export default function SpotDetailScreen() {
  const { token, isRestoring } = useSession();
  const insets = useScreenInsets();
  const params = useLocalSearchParams() as Record<string, string | string[] | undefined>;
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const criteria = fromParams(params);
  const hourly: HourlyCriteria | null = criteria?.mode === "hourly" ? criteria : null;
  const monthly: MonthlyCriteria | null = criteria?.mode === "monthly" ? criteria : null;

  const [spot, setSpot] = useState<PublicSpot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState(0);
  const [vehicleType, setVehicleType] = useState<VehicleType | null>(null);
  const [quote, setQuote] = useState<StayQuote | null>(null);
  const [termQuote, setTermQuote] = useState<MonthlyQuote | null>(null);

  const load = useCallback(async () => {
    if (!token || !id) return;
    try {
      const [found, { vehicles }] = await Promise.all([spotsApi.getById(token, id), profileApi.listVehicles(token)]);
      setSpot(found);
      // Price for the vehicle the driver will bring: their default if this
      // spot takes it, else the first vehicle the spot prices.
      const mine = (vehicles.find((v) => v.isDefault) ?? vehicles[0])?.vehicleType;
      // A monthly search prices the term, so only types with a monthly rate count.
      const priced = found.pricing.filter((p) => !monthly || p.pricePerMonth !== null).map((p) => p.vehicleType);
      setVehicleType(mine && priced.includes(mine) ? mine : priced[0] ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? "This spot is no longer available." : "Could not load this spot.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id, criteria?.mode]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!token || !id || !hourly || !vehicleType) return;
    spotsApi
      .quote(token, id, { vehicleType, startsAt: hourly.from, endsAt: hourly.to })
      .then(setQuote)
      .catch(() => setQuote(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id, vehicleType, hourly?.from, hourly?.to]);

  const termKey = monthly ? `${monthly.startDate}|${monthly.months}|${monthly.days.join(",")}|${monthly.startMinute}|${monthly.endMinute}` : null;
  useEffect(() => {
    if (!token || !id || !monthly || !vehicleType) return;
    monthlyApi
      .quote(token, id, {
        vehicleType,
        startDate: monthly.startDate,
        months: monthly.months,
        days: monthly.days,
        startMinute: monthly.startMinute,
        endMinute: monthly.endMinute,
      })
      .then(setTermQuote)
      .catch(() => setTermQuote(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id, vehicleType, termKey]);

  const toggleSave = async () => {
    if (!token || !spot) return;
    const next = !spot.saved;
    setSpot({ ...spot, saved: next });
    try {
      await (next ? spotsApi.save(token, spot.id) : spotsApi.unsave(token, spot.id));
    } catch {
      setSpot((current) => (current ? { ...current, saved: !next } : current));
    }
  };

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));
  const openReviews = () => id && router.push({ pathname: "/spots/reviews", params: { id } });

  if (!spot) {
    return (
      <PhoneFrame>
        <View style={[s.screen, { paddingTop: insets.top + 12, padding: 20 }]}>
          <Pressable onPress={back} accessibilityRole="button" accessibilityLabel="Back" style={s.plainBack}>
            <ChevronLeftIcon />
          </Pressable>
          {error ? <ErrorNotice message={error} /> : <ActivityIndicator color={colors.ink} style={s.loading} />}
        </View>
      </PhoneFrame>
    );
  }

  const rate = spot.pricing.find((p) => p.vehicleType === vehicleType) ?? spot.pricing[0] ?? null;
  const otherRates = spot.pricing.filter((p) => p !== rate);
  const hours = groupByHours(spot.availability);
  const photos = spot.photos;
  const current = photos[photo] ?? null;
  const away =
    criteria && spot.latitude && spot.longitude
      ? distanceLabel(distanceKm(criteria.place, { latitude: Number(spot.latitude), longitude: Number(spot.longitude) }))
      : null;
  // The public place only: the street line and exact pin come with a paid booking.
  const place = [spot.societyName, spot.area, spot.city, spot.pincode].filter(Boolean).join(", ");

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScrollView contentContainerStyle={s.scroll}>
          <SpotCover url={current?.url} style={s.gallery}>
            <View style={[s.overlayRow, { top: insets.top + 12 }]}>
              <Pressable onPress={back} accessibilityRole="button" accessibilityLabel="Back" style={s.roundButton}>
                <ChevronLeftIcon />
              </Pressable>
              <Pressable
                onPress={() => void toggleSave()}
                accessibilityRole="button"
                accessibilityState={{ selected: spot.saved }}
                accessibilityLabel={spot.saved ? "Remove from saved" : "Save this parking"}
                style={s.roundButton}
              >
                <HeartIcon filled={spot.saved} />
              </Pressable>
            </View>
            {photos.length > 1 ? (
              <>
                <Pressable
                  onPress={() => setPhoto((photo + photos.length - 1) % photos.length)}
                  accessibilityRole="button"
                  accessibilityLabel="Previous photo"
                  style={[s.navButton, { left: 12 }]}
                >
                  <ChevronLeftIcon size={16} />
                </Pressable>
                <Pressable
                  onPress={() => setPhoto((photo + 1) % photos.length)}
                  accessibilityRole="button"
                  accessibilityLabel="Next photo"
                  style={[s.navButton, { right: 12 }]}
                >
                  <ChevronRightIcon size={16} color={colors.ink} />
                </Pressable>
                <View style={s.counter}>
                  <Text style={s.counterText}>
                    {photo + 1} / {photos.length}
                  </Text>
                </View>
              </>
            ) : null}
          </SpotCover>

          <View style={s.body}>
            <View style={s.gap6}>
              <Text style={s.title} accessibilityRole="header">
                {spot.name}
              </Text>
              {spot.rating.count > 0 ? (
                <Pressable
                  onPress={openReviews}
                  accessibilityRole="link"
                  accessibilityLabel={`Rated ${spot.rating.average?.toFixed(1)} out of 5. See ${reviewCountLabel(spot.rating.count)}`}
                  style={s.row}
                >
                  <StarIcon size={15} />
                  <Text style={s.ratingValue}>{spot.rating.average?.toFixed(1)}</Text>
                  <Text style={s.reviewsLink}>{reviewCountLabel(spot.rating.count)}</Text>
                </Pressable>
              ) : (
                <View style={s.row}>
                  <RatingBadge rating={null} count={0} />
                  <Text style={s.muted}>No reviews yet</Text>
                </View>
              )}
              <View style={s.row}>
                <PinIcon size={15} color={colors.inkMuted} />
                <Text style={s.muted} numberOfLines={2}>
                  {[spot.area, spot.city].filter(Boolean).join(", ") || spot.venueName}
                  {away ? ` · about ${away} from your destination` : ""}
                </Text>
              </View>
              {spot.description ? <Text style={s.description}>{spot.description}</Text> : null}
            </View>

            {hourly ? (
              <View style={s.stay}>
                <CalendarIcon size={20} color={colors.ink} />
                <View style={s.flex}>
                  <Text style={s.stayWhen}>{describeCriteria(hourly)}</Text>
                  {quote ? (
                    quote.available ? (
                      <View style={s.row}>
                        <CheckIcon size={13} color="#166534" />
                        <Text style={s.ok}>Available for your whole time</Text>
                      </View>
                    ) : (
                      <Text style={s.bad}>{quote.reason}</Text>
                    )
                  ) : null}
                </View>
                <Pressable onPress={() => router.replace("/home")} accessibilityRole="button" style={s.change}>
                  <Text style={s.changeText}>Change</Text>
                </Pressable>
              </View>
            ) : null}

            {monthly ? (
              <View style={s.stay}>
                <CalendarIcon size={20} color={colors.ink} />
                <View style={s.flex}>
                  <Text style={s.stayWhen}>
                    {termQuote ? termRange(termQuote.startDate, termQuote.lastDate, termQuote.months) : describeCriteria(monthly)}
                  </Text>
                  <Text style={s.muted}>{termSchedule(monthly)}</Text>
                  {termQuote ? (
                    termQuote.available ? (
                      <View style={s.row}>
                        <CheckIcon size={13} color="#166534" />
                        <Text style={s.ok}>Free for every day of your term</Text>
                      </View>
                    ) : (
                      <Text style={s.bad}>{termQuote.reason}</Text>
                    )
                  ) : null}
                </View>
                <Pressable onPress={() => router.replace("/home")} accessibilityRole="button" style={s.change}>
                  <Text style={s.changeText}>Change</Text>
                </Pressable>
              </View>
            ) : null}

            {rate ? (
              <Section title={`PRICING${spot.pricing.length > 1 ? ` · ${VEHICLE_LABELS[rate.vehicleType].toUpperCase()}` : ""}`}>
                <View style={s.tiles}>
                  {rate.pricePerHour ? <Tile amount={formatRupees(rate.pricePerHour)} unit="per hour" /> : null}
                  {rate.pricePerDay ? <Tile amount={formatRupees(rate.pricePerDay)} unit="per day" /> : null}
                  {rate.pricePerMonth ? <Tile amount={formatRupees(rate.pricePerMonth)} unit="per month" /> : null}
                </View>
                {quote?.available && quote.basis === "DAILY" && quote.hourlyAmount ? (
                  <Text style={s.note}>
                    For your stay the day rate applies: you pay {formatRupees(quote.parking)}, not{" "}
                    {formatRupees(quote.hourlyAmount)} by the hour.
                  </Text>
                ) : null}
                {otherRates.map((other) => (
                  <Text key={other.id} style={s.note}>
                    {VEHICLE_LABELS[other.vehicleType]}: {rateLine(other)}
                  </Text>
                ))}
              </Section>
            ) : null}

            <Section title="PARKING INFORMATION">
              <DataRow label="Parking type" value={`${spaceLabel(spot.spaceType)}${spot.amenities.includes("COVERED") ? " · covered" : ""}`} />
              <DataRow
                label="Suitable for"
                value={
                  spot.maxVehicleSize
                    ? VEHICLE_SIZE_LABELS[spot.maxVehicleSize]
                    : spot.pricing.map((p) => VEHICLE_LABELS[p.vehicleType]).join(" & ")
                }
              />
              {spot.maxVehicleHeightCm ? <DataRow label="Height limit" value={heightLabel(spot.maxVehicleHeightCm)} /> : null}
              {spot.bayWidthCm && spot.bayLengthCm ? (
                <DataRow label="Bay size" value={`${feetLabel(spot.bayWidthCm)} × ${feetLabel(spot.bayLengthCm)}`} />
              ) : null}
              {hours.map((row) => (
                <DataRow key={row.label} label={row.label} value={row.hours} />
              ))}
              {spot.minStayMinutes ? <DataRow label="Shortest stay" value={durationText(spot.minStayMinutes)} /> : null}
              {spot.maxStayMinutes ? <DataRow label="Longest stay" value={durationText(spot.maxStayMinutes)} /> : null}
              {spot.advanceDays ? <DataRow label="Book ahead" value={`Up to ${spot.advanceDays} days`} /> : null}
              {spot.rules ? <DataRow label="Good to know" value={spot.rules} /> : null}
            </Section>

            {spot.amenities.length > 0 || spot.open24x7 ? (
              <Section title="AMENITIES">
                <View style={s.amenities}>
                  {spot.amenities.map((amenity) => (
                    <View key={amenity} style={s.amenity}>
                      <CheckIcon size={15} color="#166534" />
                      <Text style={s.amenityText}>{AMENITY_LABELS[amenity]}</Text>
                    </View>
                  ))}
                  {spot.open24x7 ? (
                    <View style={s.amenity}>
                      <CheckIcon size={15} color="#166534" />
                      <Text style={s.amenityText}>24/7 access</Text>
                    </View>
                  ) : null}
                  {spot.amenityNote ? (
                    <View style={s.amenity}>
                      <CheckIcon size={15} color="#166534" />
                      <Text style={s.amenityText}>{spot.amenityNote}</Text>
                    </View>
                  ) : null}
                </View>
              </Section>
            ) : null}

            <View style={s.access}>
              <View style={s.row}>
                <View style={s.keyBadge}>
                  <KeyIcon size={17} color={colors.onInk} />
                </View>
                <Text style={s.accessTitle}>How to get in</Text>
              </View>
              {spot.entryMethod ? <DataRow label="Entry method" value={ENTRY_METHOD_LABELS[spot.entryMethod]} /> : null}
              {spot.entryPoint ? <DataRow label="Entry" value={spot.entryPoint} /> : null}
              <DataRow label="Gate timing" value={spot.open24x7 ? "Open 24 hours" : hours.map((h) => `${h.label} ${h.hours}`).join(" · ")} />
              <View style={s.locked}>
                <LockIcon size={14} color={colors.inkMuted} />
                <Text style={s.lockedText}>The full address, the exact bay and how to get in are shared as soon as you've paid.</Text>
              </View>
            </View>

            {spot.latitude && spot.longitude ? (
              <Section title="LOCATION">
                <LocationMap token={token} latitude={Number(spot.latitude)} longitude={Number(spot.longitude)} />
                {place ? <Text style={s.address}>{place}</Text> : null}
                <Text style={s.note}>Approximate location, within about 100 m. The exact spot comes with your booking.</Text>
              </Section>
            ) : null}

            {spot.rating.count > 0 ? (
              <Section title="REVIEWS">
                <RatingSummaryView summary={spot.rating} />
                <View>
                  {spot.reviews.map((review) => (
                    <ReviewItem key={review.id} review={review} />
                  ))}
                </View>
                <Button
                  label={spot.rating.count > spot.reviews.length ? `See all ${reviewCountLabel(spot.rating.count)}` : "See all reviews"}
                  variant="ghost"
                  onPress={openReviews}
                />
              </Section>
            ) : null}

            <View style={[s.row, s.host]}>
              <View style={s.avatar}>
                <Text style={s.avatarText}>{spot.host.displayName.charAt(0)}</Text>
              </View>
              <View style={s.flex}>
                <Text style={s.hostName}>Hosted by {spot.host.displayName}</Text>
                {spot.host.since ? <Text style={s.muted}>Host since {spot.host.since}</Text> : null}
              </View>
              <View style={s.row}>
                <ShieldIcon size={14} color="#166534" />
                <Text style={s.verified}>Verified</Text>
              </View>
            </View>

            <View style={s.policy}>
              <Text style={s.policyTitle}>Cancellation</Text>
              <Text style={s.policyText}>
                {monthly
                  ? "Monthly: cancel before your term starts for a full refund. After it starts, the parking for whole months not yet begun comes back."
                  : "Free until an hour before your parking starts. After that, half the parking amount back until it starts. Nothing once it has started."}
              </Text>
            </View>
          </View>
        </ScrollView>

        <View style={s.bar}>
          {hourly ? (
            <>
              <View style={s.flex}>
                <Text style={s.barPrice}>{quote ? formatRupees(quote.total) : "—"}</Text>
                <Text style={s.barSub}>incl. fees · {describeCriteria(hourly)}</Text>
              </View>
              <View style={s.barCta}>
                <Button
                  label="Reserve Parking"
                  size="lg"
                  disabled={!quote?.available}
                  onPress={() =>
                    router.push({
                      pathname: "/spots/checkout",
                      params: { id: spot.id, from: hourly.from, to: hourly.to, ...(criteria ? toParams(criteria) : {}) },
                    })
                  }
                />
              </View>
            </>
          ) : monthly ? (
            <>
              <View style={s.flex}>
                <Text style={s.barPrice}>{termQuote?.available ? formatRupees(termQuote.total) : "—"}</Text>
                <Text style={s.barSub}>incl. fees · {monthsLabel(monthly.months)}, paid once</Text>
              </View>
              <View style={s.barCta}>
                <Button
                  label="Reserve Monthly"
                  size="lg"
                  disabled={!termQuote?.available}
                  onPress={() =>
                    router.push({ pathname: "/spots/checkout-monthly", params: { id: spot.id, ...toParams(monthly) } })
                  }
                />
              </View>
            </>
          ) : (
            <View style={s.flex}>
              <Text style={s.barSub}>Search for the hours you want to book this spot.</Text>
              <Button label="Search hours" variant="ghost" onPress={() => router.replace("/home")} />
            </View>
          )}
        </View>
      </View>
    </PhoneFrame>
  );
}

function LocationMap({ token, latitude, longitude }: { token: string; latitude: number; longitude: number }) {
  const { uri } = useStaticMap(token, { latitude, longitude }, { zoom: 16, width: 350, height: 170 });
  return (
    <View style={s.map}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
      <View style={s.mapPin}>
        <PinIcon size={30} color={colors.ink} />
      </View>
    </View>
  );
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

function Tile({ amount, unit }: { amount: string; unit: string }) {
  return (
    <View style={s.tile}>
      <Text style={s.tileAmount}>{amount}</Text>
      <Text style={s.tileUnit}>{unit}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  scroll: { paddingBottom: 24 },
  loading: { paddingVertical: space.xxl },
  plainBack: { width: 44, height: 44, justifyContent: "center", marginBottom: space.md },
  gallery: { aspectRatio: 4 / 3 },
  overlayRow: { position: "absolute", left: 14, right: 14, flexDirection: "row", justifyContent: "space-between" },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  navButton: {
    position: "absolute",
    top: "50%",
    marginTop: -18,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  counter: {
    position: "absolute",
    right: 14,
    bottom: 14,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
    backgroundColor: "rgba(17,24,39,0.86)",
    justifyContent: "center",
  },
  counterText: { fontSize: 12, fontWeight: "700", color: colors.onInk },
  body: { padding: 20, gap: 22 },
  gap6: { gap: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  flex: { flex: 1, gap: 2 },
  title: { fontSize: 23, fontWeight: "700", color: colors.ink, letterSpacing: -0.3 },
  ratingValue: { fontSize: 14, fontWeight: "700", color: colors.ink },
  reviewsLink: { fontSize: 14, color: colors.inkMuted, textDecorationLine: "underline" },
  muted: { fontSize: 14, color: colors.inkMuted, flexShrink: 1 },
  stay: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.canvas,
    borderRadius: radius.md,
    padding: 14,
  },
  stayWhen: { fontSize: 14, fontWeight: "700", color: colors.ink },
  ok: { fontSize: 12, fontWeight: "600", color: "#166534" },
  bad: { fontSize: 12, fontWeight: "600", color: "#b91c1c" },
  change: { minHeight: 44, justifyContent: "center" },
  changeText: { fontSize: 14, fontWeight: "600", color: colors.ink, textDecorationLine: "underline" },
  section: { gap: space.sm },
  sectionTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 1.2, color: colors.inkMuted, marginBottom: 2 },
  tiles: { flexDirection: "row", gap: space.sm },
  tile: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, gap: 2 },
  tileAmount: { fontSize: 19, fontWeight: "700", color: colors.ink },
  tileUnit: { fontSize: 12, color: colors.inkMuted },
  note: { fontSize: 13, lineHeight: 19, color: "#374151" },
  amenities: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  amenity: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: "42%" },
  amenityText: { fontSize: 14, color: colors.ink },
  access: { borderWidth: 2, borderColor: colors.ink, borderRadius: 14, padding: space.lg, gap: space.sm },
  keyBadge: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" },
  accessTitle: { fontSize: 16, fontWeight: "700", color: colors.ink, marginLeft: 4 },
  locked: { flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: colors.canvas, borderRadius: radius.sm, padding: space.md, marginTop: 4 },
  lockedText: { flex: 1, fontSize: 13, color: colors.inkMuted },
  map: { height: 170, borderRadius: radius.md, overflow: "hidden", backgroundColor: "#eceee8", alignItems: "center", justifyContent: "center" },
  mapPin: { marginTop: -30 },
  description: { fontSize: 14, lineHeight: 20, color: colors.ink, marginTop: 2 },
  address: { fontSize: 14, lineHeight: 20, color: colors.ink },
  host: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.lg, gap: space.md },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.canvas, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 16, fontWeight: "700", color: colors.ink },
  hostName: { fontSize: 15, fontWeight: "600", color: colors.ink },
  verified: { fontSize: 12, fontWeight: "600", color: "#166534" },
  policy: { backgroundColor: colors.canvas, borderRadius: radius.md, padding: 14, gap: 4 },
  policyTitle: { fontSize: 14, fontWeight: "700", color: colors.ink },
  policyText: { fontSize: 13, lineHeight: 19, color: colors.inkMuted },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.lg,
    paddingHorizontal: 20,
    paddingTop: space.md,
    paddingBottom: 18,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  barPrice: { fontSize: 21, fontWeight: "700", color: colors.ink },
  barSub: { fontSize: 12, color: colors.inkMuted },
  barCta: { flex: 1.3 },
});
