import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { spotListingApi, spotsApi } from "@/api";
import type { AddressParts, PlaceSuggestion } from "@/types/api.types";
import {
  Button,
  Card,
  CheckIcon,
  Field,
  InfoIcon,
  LockIcon,
  PinIcon,
  RestoringScreen,
  WizardShell,
} from "@/components/ui";
import { useStaticMap } from "@/hooks/useStaticMap";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useDriverLocation } from "@/hooks/useDriverLocation";
import { usePlaceSearch } from "@/hooks/usePlaceSearch";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { useWizardBack } from "@/hooks/useWizardBack";
import { useWizardContinue } from "@/hooks/useWizardContinue";
import { takePin } from "@/lib/pinHandoff";
import {
  TOTAL_STEPS,
  firstStepPath,
  stepNumber,
} from "@/constants/wizard";
import { colors, radius, space, type } from "@/theme";

/**
 * Step 2. Where the space is, on the listing the previous step created.
 *
 * Search fills the coordinates; the map then moves the pin without touching
 * the typed address. Those are two different truths -- the address a driver
 * reads and the point their maps app routes to -- and a gate that is 40m down
 * a lane from the building's registered address is the normal case, not the
 * exception.
 *
 * So the search area is not the parking location. A search result (or "my
 * location") only gives the map somewhere to start; the pin counts once the
 * host has placed it on the map screen, and moving it any other way asks for
 * that again. Drivers see the society, area and city before booking; the
 * house, street and exact pin come with payment.
 */

export default function AddressScreen() {
  const { spot, loading, isRestoring, token } = useSpotDraft();
  const { requestLocation } = useDriverLocation();
  const back = useWizardBack("address", spot?.id);
  const proceed = useWizardContinue("address");
  const {
    query,
    setQuery,
    results,
    searching,
    unavailableReason,
    settle,
    sessionToken,
  } = usePlaceSearch(token);

  const [societyName, setSocietyName] = useState("");
  const [building, setBuilding] = useState("");
  const [street, setStreet] = useState("");
  const [area, setArea] = useState("");
  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState("");
  const [pincode, setPincode] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [placeId, setPlaceId] = useState<string | undefined>();
  // Placed on the map by the host, as opposed to a search result's point.
  const [pinPlaced, setPinPlaced] = useState(false);

  useEffect(() => {
    if (!spot) return;
    if (spot.latitude) setLatitude(Number(spot.latitude));
    if (spot.longitude) setLongitude(Number(spot.longitude));
    setPinPlaced(Boolean(spot.pinConfirmedAt));
    setPlaceId(spot.googlePlaceId ?? undefined);
    setSocietyName(spot.societyName ?? "");
    setBuilding(spot.building ?? "");
    // Older listings have only the one line; it goes where the street does.
    setStreet(spot.street ?? (spot.societyName || spot.building ? "" : spot.addressLine ?? ""));
    setArea(spot.area ?? "");
    if (spot.city) setCity(spot.city);
    if (spot.state) setStateName(spot.state);
    if (spot.pincode) setPincode(spot.pincode);
  }, [spot]);

  const { run: useMyLocation, busy: locating } = useAsyncAction(async () => {
    const at = await requestLocation();
    if (!at) return;
    setLatitude(at.latitude);
    setLongitude(at.longitude);
    // Where the phone is, not necessarily the bay: still to be placed.
    setPinPlaced(false);
  });

  /**
   * Writes whatever a lookup managed to work out into the fields.
   *
   * Only the parts that came back are written. A provider that knows the city
   * but not the street must not blank a street the host typed, and an empty
   * string from an address with no street line is not an answer -- it is the
   * absence of one.
   */
  const applyAddress = useCallback((parts: AddressParts) => {
    const road = parts.street ?? parts.addressLine;
    if (road) setStreet(road);
    if (parts.area) setArea(parts.area);
    if (parts.city) setCity(parts.city);
    if (parts.state) setStateName(parts.state);
    if (parts.pincode) setPincode(parts.pincode);
  }, []);

  /**
   * Fills the fields from the address at a point.
   *
   * Advisory on purpose: the pin is what a driver is routed to and it is
   * already set by the time this runs, so a lookup that fails leaves the host
   * typing the address themselves rather than leaves them stuck.
   */
  const fillFromPoint = useCallback(
    async (lat: number, lng: number) => {
      if (!token) return;

      try {
        const { result } = await spotsApi.reverseGeocode(token, lat, lng);
        if (result.address) applyAddress(result.address);
      } catch (error) {
        console.warn("could not name the picked point", error);
      }
    },
    [token, applyAddress]
  );

  /**
   * Turns a picked suggestion into a pin, and into an address.
   *
   * Providers differ on whether a suggestion already carries coordinates. The
   * ones that do are resolved for free; the ones that do not need a details
   * call, and it goes out only for the row the host actually chose -- fetching
   * coordinates for every suggestion would bill for the ones they ignored.
   *
   * The details call answers with one formatted line rather than the parts a
   * listing stores, so the fields are filled from the point instead. That also
   * keeps one rule for how the fields get written: they describe wherever the
   * pin currently is, whether it got there from the search box or the map.
   */
  const { run: pick, busy: resolving, error: pickError } = useAsyncAction(
    async (result: PlaceSuggestion) => {
      const carriedSession = sessionToken();
      settle(result.description);

      // A search result is the middle of an area: somewhere for the map to
      // start, not the parking location.
      setPinPlaced(false);

      if (result.latitude !== undefined && result.longitude !== undefined) {
        setLatitude(result.latitude);
        setLongitude(result.longitude);
        setPlaceId(result.providerPlaceId);

        // A suggestion that came from a plain search already carries the
        // components; only a real type-ahead needs the second lookup.
        if (result.address) applyAddress(result.address);
        else await fillFromPoint(result.latitude, result.longitude);

        return;
      }

      if (!token || !result.providerPlaceId) return;

      const { result: place } = await spotsApi.placeDetails(
        token,
        result.providerPlaceId,
        { sessionToken: carriedSession }
      );

      setLatitude(place.latitude);
      setLongitude(place.longitude);
      setPlaceId(place.providerPlaceId);

      if (place.address) applyAddress(place.address);
      else await fillFromPoint(place.latitude, place.longitude);
    }
  );

  // The map screen leaves its result here rather than navigating back with
  // params, which would remount this form and lose what has been typed. The
  // address comes back with it: the host saw it on the map screen and pressed
  // save on it, so it is what they meant, and looking it up again here would
  // pay for the same answer twice.
  useFocusEffect(
    useCallback(() => {
      const handed = takePin();
      if (!handed) return;

      setLatitude(handed.latitude);
      setLongitude(handed.longitude);
      setPinPlaced(true);

      if (handed.address) applyAddress(handed.address);
    }, [applyAddress])
  );

  const { run: save, busy, error } = useAsyncAction(async () => {
    if (!token || !spot || latitude === null || longitude === null) return;

    await spotListingApi.saveAddress(token, spot.id, {
      societyName: societyName.trim() || null,
      building: building.trim() || null,
      street: street.trim() || null,
      area: area.trim(),
      city: city.trim(),
      state: stateName.trim(),
      pincode: pincode.trim(),
      latitude,
      longitude,
      googlePlaceId: placeId,
      pinConfirmed: pinPlaced,
    });

    proceed(spot);
  });

  if (isRestoring || loading) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;
  // Arrived without a listing -- a stale link, or a reload after the id was
  // dropped. The step before this one is what creates it.
  if (!spot) return <Redirect href={firstStepPath()} />;

  const hasPin = latitude !== null && longitude !== null;
  const pinOk = /^\d{6}$/.test(pincode.trim());
  const missing = !hasPin
    ? "Search for the area, or use your current location, to continue."
    : !pinPlaced
      ? "Place the pin on the map."
      : !(street.trim() || societyName.trim() || building.trim())
        ? "Add the street, or the society or building name."
        : !area.trim()
          ? "Add the area."
          : !city.trim() || !stateName.trim()
            ? "Add the city and state."
            : !pinOk
              ? "Add a 6-digit PIN code."
              : null;
  const openMap = () =>
    router.push({ pathname: "/host/spot/pin", params: { lat: String(latitude), lng: String(longitude) } });

  return (
    <WizardShell
      title="Address"
      sub="Where drivers will come to park."
      step={stepNumber("address")}
      totalSteps={TOTAL_STEPS}
      onBack={back}
      onContinue={save}
      canContinue={missing === null}
      busy={busy}
      error={error ?? pickError}
      footerNote={missing ?? undefined}
    >
      <Field
        label="Search for the area"
        value={query}
        onChangeText={setQuery}
        placeholder="Kothrud, Pune"
        autoCorrect={false}
        icon={<PinIcon color={colors.inkFaint} size={18} />}
        hint={
          unavailableReason
            ? `${unavailableReason} Enter the address below instead.`
            : resolving
              ? "Getting the location…"
              : searching
                ? "Searching…"
                : undefined
        }
      />

      {/* Suggestions sit directly under the box, as one bordered group, so a
          list of three does not read as three unrelated cards. */}
      {results.length > 0 ? (
        <View style={s.results}>
          {results.map((result, index) => (
            <Pressable
              key={`${result.providerPlaceId ?? result.description}`}
              onPress={() => pick(result)}
              accessibilityRole="button"
              style={({ pressed }) => [
                s.result,
                index > 0 && s.resultDivided,
                pressed && s.resultPressed,
              ]}
            >
              <PinIcon color={colors.inkMuted} size={16} />
              <Text style={s.resultText} numberOfLines={2}>
                {result.description}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={s.pinCard}>
        <Text style={s.pinTitle}>Exact parking location</Text>
        <Text style={s.pinHint}>Place the pin exactly where drivers should park — the gate or the bay, not the middle of the area.</Text>

        {hasPin ? (
          <>
            <PinPreview token={token} latitude={latitude!} longitude={longitude!} placed={pinPlaced} />
            <View style={s.pinStatus}>
              {pinPlaced ? <CheckIcon color="#166534" size={15} /> : <InfoIcon color={colors.accentInk} size={15} />}
              <Text style={[s.pinStatusText, !pinPlaced && s.pinStatusWarn]}>
                {pinPlaced ? "Pin placed" : "Not placed yet — this is only a starting point for the map."}
              </Text>
            </View>
            <Button label={pinPlaced ? "Adjust pin" : "Place pin on map"} variant={pinPlaced ? "ghost" : "primary"} onPress={openMap} />
          </>
        ) : null}

        <Pressable
          onPress={useMyLocation}
          disabled={locating}
          accessibilityRole="button"
          style={({ pressed }) => [s.locate, pressed && s.locatePressed]}
        >
          <PinIcon color={colors.ink} size={15} />
          <Text style={s.locateLabel}>{locating ? "Finding you…" : "Use my current location"}</Text>
        </Pressable>
      </View>

      {/* Grouped rather than loose, so this screen reads like the rest of the
          app: every other one puts related fields inside a bordered card with
          a small uppercase heading. */}
      <Card heading="Address details">
        <View style={s.fields}>
          <Field
            label="Apartment / Society name"
            optional
            value={societyName}
            onChangeText={setSocietyName}
            placeholder="Sai Krupa Society"
            maxLength={120}
          />
          <Field
            label="Building / House number"
            optional
            value={building}
            onChangeText={setBuilding}
            placeholder="B-402"
            maxLength={60}
          />
          <Field label="Street / Road" value={street} onChangeText={setStreet} placeholder="Karve Road" maxLength={200} />
          <Field label="Area" value={area} onChangeText={setArea} placeholder="Kothrud" maxLength={120} />
          <Field label="City" value={city} onChangeText={setCity} placeholder="Pune" maxLength={100} />
          <Field label="State" value={stateName} onChangeText={setStateName} placeholder="Maharashtra" maxLength={100} />
          <Field
            label="PIN code"
            value={pincode}
            onChangeText={(t) => setPincode(t.replace(/[^0-9]/g, "").slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="411038"
            error={pincode.length > 0 && !pinOk ? "A PIN code has 6 digits." : null}
          />
        </View>
      </Card>

      <View style={s.privacy}>
        <LockIcon color={colors.inkMuted} size={14} />
        <Text style={s.privacyText}>
          Drivers see the society, area and city before booking. The house number, street and exact pin are shared
          only after they pay.
        </Text>
      </View>
    </WizardShell>
  );
}

const s = StyleSheet.create({
  results: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    overflow: "hidden",
    marginTop: -space.sm,
  },
  result: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    minHeight: 48,
  },
  resultDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  resultPressed: { backgroundColor: colors.canvas },
  fields: { gap: space.lg, paddingTop: space.sm },
  resultText: { flex: 1, fontSize: 14, color: colors.ink },
  pinCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
    gap: 4,
  },
  pinTitle: { ...type.label, color: colors.ink },
  pinHint: { ...type.caption, color: colors.inkMuted, marginBottom: space.md },
  pinStatus: { flexDirection: "row", alignItems: "center", gap: space.sm, marginVertical: space.sm },
  pinStatusText: { flex: 1, fontSize: 13, fontWeight: "600", color: "#166534" },
  pinStatusWarn: { color: colors.accentInk },
  preview: {
    height: 150,
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: colors.canvas,
    alignItems: "center",
    justifyContent: "center",
  },
  previewPin: { position: "absolute", top: "50%", left: "50%", marginLeft: -15, marginTop: -30 },
  previewCoords: { ...type.caption, color: colors.inkFaint, position: "absolute", bottom: 8 },
  privacy: { flexDirection: "row", gap: space.sm, alignItems: "flex-start" },
  privacyText: { flex: 1, ...type.caption, color: colors.inkMuted, lineHeight: 17 },
  locate: {
    marginTop: space.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    minHeight: 44,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.canvas,
  },
  locatePressed: { backgroundColor: colors.border },
  locateLabel: { fontSize: 13, fontWeight: "600", color: colors.ink },
});

/**
 * The pin on a small map, so the host can see where it is without opening
 * the full-screen picker. Without a map provider it still shows the point.
 */
function PinPreview({ token, latitude, longitude, placed }: { token: string; latitude: number; longitude: number; placed: boolean }) {
  const { uri } = useStaticMap(token, { latitude, longitude }, { zoom: 17, width: 350, height: 150 });
  return (
    <View style={s.preview} accessible accessibilityLabel={placed ? "Map with your parking pin" : "Map with the search result's point"}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : (
        <Text style={s.previewCoords}>
          {latitude.toFixed(5)}, {longitude.toFixed(5)}
        </Text>
      )}
      <View style={s.previewPin}>
        <PinIcon size={30} color={placed ? colors.ink : colors.inkFaint} />
      </View>
    </View>
  );
}
