import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { hostApi, spotListingApi, spotsApi } from "@/api";
import type { AddressParts, PlaceSuggestion } from "@/types/api.types";
import {
  Button,
  Card,
  Field,
  PinIcon,
  RestoringScreen,
  WizardShell,
} from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useDriverLocation } from "@/hooks/useDriverLocation";
import { usePlaceSearch } from "@/hooks/usePlaceSearch";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { takePin } from "@/lib/pinHandoff";
import { useSession } from "@/providers/SessionProvider";
import { TOTAL_STEPS, nextStepPath, stepNumber } from "@/constants/wizard";
import { colors, radius, space, type } from "@/theme";

/**
 * Step 2. Where the space is.
 *
 * Search fills the coordinates; the map then moves the pin without touching
 * the typed address. Those are two different truths -- the address a driver
 * reads and the point their maps app routes to -- and a gate that is 40m down
 * a lane from the building's registered address is the normal case, not the
 * exception.
 */

export default function AddressScreen() {
  const { spot, loading, isRestoring, token } = useSpotDraft();
  const { requestLocation } = useDriverLocation();
  const { user, setUser } = useSession();
  const {
    query,
    setQuery,
    results,
    searching,
    unavailableReason,
    settle,
    sessionToken,
  } = usePlaceSearch(token);

  const [addressLine, setAddressLine] = useState("");
  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState("");
  const [pincode, setPincode] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [placeId, setPlaceId] = useState<string | undefined>();

  useEffect(() => {
    if (!spot) return;
    if (spot.latitude) setLatitude(Number(spot.latitude));
    if (spot.longitude) setLongitude(Number(spot.longitude));
    setPlaceId(spot.googlePlaceId ?? undefined);
  }, [spot]);

  // Onboarding already collected the address onto the host profile. Asking
  // for it again on a blank form is asking a host to retype what they just
  // typed, and the two would then be free to disagree.
  useEffect(() => {
    if (!token) return;

    hostApi
      .getProfile(token)
      .then(({ profile }) => {
        if (!profile) return;
        setAddressLine((current) => current || profile.addressLine);
        setCity((current) => current || profile.city);
        setStateName((current) => current || profile.state);
        setPincode((current) => current || profile.pincode);
      })
      .catch(() => undefined);
  }, [token]);

  const { run: useMyLocation, busy: locating } = useAsyncAction(async () => {
    const at = await requestLocation();
    if (!at) return;
    setLatitude(at.latitude);
    setLongitude(at.longitude);
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
    if (parts.addressLine) setAddressLine(parts.addressLine);
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

      if (handed.address) applyAddress(handed.address);
    }, [applyAddress])
  );

  const { run: save, busy, error } = useAsyncAction(async () => {
    if (!token || latitude === null || longitude === null) return;

    const address = {
      addressLine: addressLine.trim(),
      city: city.trim(),
      state: stateName.trim(),
      pincode: pincode.trim(),
      latitude,
      longitude,
    };

    let spotId: string;

    if (spot) {
      spotId = spot.id;
      await spotListingApi.saveAddress(token, spot.id, {
        ...address,
        googlePlaceId: placeId,
      });
    } else {
      // No host profile yet: this step creates it, and the API opens the
      // first draft listing alongside. This is the only place the address is
      // collected for a brand-new host -- onboarding used to ask for it
      // separately, which had a host typing it twice into two rows that could
      // then disagree. A later spot arrives here already having an id (the
      // dashboard's "Add another spot" opens the blank draft first), so this
      // branch runs at most once per host.
      const created = await hostApi.createProfile(token, address);
      spotId = created.spotId;

      // The session's hasHostProfile decides whether later steps bother
      // asking for the spot at all, so it has to move with the profile --
      // otherwise every step after this one believes there is nothing to load.
      if (user) setUser({ ...user, hasHostProfile: true });
    }

    router.push(nextStepPath("address", spotId));
  });

  if (isRestoring || loading) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  const hasPin = latitude !== null && longitude !== null;
  const canContinue = Boolean(
    hasPin && addressLine.trim() && city.trim() && stateName.trim() && /^\d{6}$/.test(pincode.trim())
  );

  return (
    <WizardShell
      title="Address"
      sub="Where drivers will come to park."
      step={stepNumber("address")}
      totalSteps={TOTAL_STEPS}
      onBack={() => router.back()}
      onContinue={save}
      canContinue={canContinue}
      busy={busy}
      error={error ?? pickError}
      footerNote={hasPin ? undefined : "Search for the area, or drop a pin, to continue."}
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
        <Text style={s.pinTitle}>Exact spot</Text>

        {hasPin ? (
          <>
            <Text style={s.pinValue}>
              {latitude!.toFixed(5)}, {longitude!.toFixed(5)}
            </Text>
            <Text style={s.pinHint}>
              The point drivers are sent to. Open the map to move it onto your
              gate or entrance.
            </Text>
            <Button
              label="Adjust on map"
              variant="ghost"
              onPress={() =>
                router.push({
                  pathname: "/host/spot/pin",
                  params: { lat: String(latitude), lng: String(longitude) },
                })
              }
            />
          </>
        ) : (
          <>
            <Text style={s.pinHint}>
              Pick your area above, or use your current location, and then place
              the pin on a map.
            </Text>

            <Pressable
              onPress={useMyLocation}
              disabled={locating}
              accessibilityRole="button"
              style={({ pressed }) => [s.locate, pressed && s.locatePressed]}
            >
              <PinIcon color={colors.ink} size={15} />
              <Text style={s.locateLabel}>
                {locating ? "Finding you…" : "Use my current location"}
              </Text>
            </Pressable>
          </>
        )}
      </View>

      {/* Grouped rather than loose, so this screen reads like the rest of the
          app: every other one puts related fields inside a bordered card with
          a small uppercase heading. */}
      <Card heading="Address details">
        <View style={s.fields}>
          <Field label="Address" value={addressLine} onChangeText={setAddressLine} maxLength={200} />
          <Field label="City" value={city} onChangeText={setCity} maxLength={100} />
          <Field label="State" value={stateName} onChangeText={setStateName} maxLength={100} />
          <Field
            label="PIN code"
            value={pincode}
            onChangeText={setPincode}
            keyboardType="number-pad"
            maxLength={6}
          />
        </View>
      </Card>
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
  pinValue: { fontSize: 15, fontWeight: "600", color: colors.accent },
  pinHint: { ...type.caption, color: colors.inkMuted, marginBottom: space.md },
  locate: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    minHeight: 44,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.canvas,
    marginBottom: space.md,
  },
  locatePressed: { backgroundColor: colors.border },
  locateLabel: { fontSize: 13, fontWeight: "600", color: colors.ink },
});
