import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { hostApi, spotListingApi, spotsApi } from "@/api";
import {
  Field,
  PinIcon,
  RestoringScreen,
  WizardShell,
} from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useDriverLocation } from "@/hooks/useDriverLocation";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { useSession } from "@/providers/SessionProvider";
import { TOTAL_STEPS, nextStepPath, stepNumber } from "@/constants/wizard";
import { colors, radius, space, type } from "@/theme";
import type { GeocodeResult } from "@/types/api.types";

/**
 * Step 2. Where the space is.
 *
 * Search fills the coordinates; the nudge controls then move the pin without
 * touching the typed address. Those are two different truths -- the address a
 * driver reads and the point their maps app routes to -- and a gate that is
 * 40m down a lane from the building's registered address is the normal case,
 * not the exception.
 */

/** One tap of a nudge control, in degrees. Roughly 11m at this latitude. */
const NUDGE = 0.0001;

export default function AddressScreen() {
  const { spot, loading, isRestoring, token } = useSpotDraft();
  const { requestLocation } = useDriverLocation();
  const { user, setUser } = useSession();

  const [addressLine, setAddressLine] = useState("");
  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState("");
  const [pincode, setPincode] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [placeId, setPlaceId] = useState<string | undefined>();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searchUnavailable, setSearchUnavailable] = useState(false);

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

  const { run: search, busy: searching } = useAsyncAction(async () => {
    if (!token || query.trim().length < 3) return;

    try {
      const { results: found } = await spotsApi.geocode(token, query.trim());
      setResults(found);
      setSearchUnavailable(false);
    } catch {
      // GEOCODE_PROVIDER=none answers 503. That is a deployment choice, not a
      // failure the host caused, so the manual fields carry on working.
      setSearchUnavailable(true);
      setResults([]);
    }
  });

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

    if (spot) {
      await spotListingApi.saveAddress(token, spot.id, {
        ...address,
        googlePlaceId: placeId,
      });
    } else {
      // No host profile yet: this step creates it, and the API opens the
      // draft listing alongside. This is the only place the address is
      // collected -- onboarding used to ask for it separately, which had a
      // host typing it twice into two rows that could then disagree.
      await hostApi.createProfile(token, address);

      // The session's hasHostProfile decides whether later steps bother
      // asking for the spot at all, so it has to move with the profile --
      // otherwise every step after this one believes there is nothing to load.
      if (user) setUser({ ...user, hasHostProfile: true });
    }

    router.push(nextStepPath("address"));
  });

  if (isRestoring || loading) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  const hasPin = latitude !== null && longitude !== null;
  const canContinue = Boolean(
    hasPin && addressLine.trim() && city.trim() && stateName.trim() && /^\d{6}$/.test(pincode.trim())
  );

  const nudge = (dLat: number, dLng: number) => {
    if (latitude === null || longitude === null) return;
    setLatitude(Number((latitude + dLat).toFixed(6)));
    setLongitude(Number((longitude + dLng).toFixed(6)));
  };

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
      error={error}
      footerNote={hasPin ? undefined : "Search for the area, or drop a pin, to continue."}
    >
      <Field
        label="Search for the area"
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={search}
        returnKeyType="search"
        placeholder="Kothrud, Pune"
        icon={<PinIcon color={colors.inkFaint} size={18} />}
        hint={searchUnavailable ? "Search is off right now — enter the address below." : undefined}
      />

      {results.map((result) => (
        <Pressable
          key={`${result.providerPlaceId ?? result.description}`}
          onPress={() => {
            setLatitude(result.latitude);
            setLongitude(result.longitude);
            setPlaceId(result.providerPlaceId);
            setQuery(result.description);
            setResults([]);
          }}
          style={s.result}
        >
          <PinIcon color={colors.inkMuted} size={16} />
          <Text style={s.resultText}>{result.description}</Text>
        </Pressable>
      ))}

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

      {/* Standing in for a draggable map pin. The fine-tune step matters more
          than the map does: the difference between a building's address and
          the gate a driver should actually pull into is usually a few metres,
          and this is what closes it. */}
      <View style={s.pinCard}>
        <Text style={s.pinTitle}>Exact spot</Text>
        <Text style={s.pinValue}>
          {hasPin ? `${latitude!.toFixed(5)}, ${longitude!.toFixed(5)}` : "Not set yet"}
        </Text>
        <Text style={s.pinHint}>
          Nudge the pin to the gate or entrance drivers should head for.
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

        <View style={s.pad}>
          <NudgeButton label="↑" onPress={() => nudge(NUDGE, 0)} disabled={!hasPin} />
          <View style={s.padRow}>
            <NudgeButton label="←" onPress={() => nudge(0, -NUDGE)} disabled={!hasPin} />
            <NudgeButton label="→" onPress={() => nudge(0, NUDGE)} disabled={!hasPin} />
          </View>
          <NudgeButton label="↓" onPress={() => nudge(-NUDGE, 0)} disabled={!hasPin} />
        </View>
      </View>
    </WizardShell>
  );
}

function NudgeButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Move pin ${label}`}
      style={({ pressed }) => [s.nudge, disabled && s.nudgeOff, pressed && s.nudgePressed]}
    >
      <Text style={s.nudgeLabel}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  result: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
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
  pad: { alignItems: "center", gap: space.sm },
  padRow: { flexDirection: "row", gap: 56 },
  nudge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.canvas,
  },
  nudgeOff: { opacity: 0.4 },
  nudgePressed: { backgroundColor: colors.border },
  nudgeLabel: { fontSize: 18, color: colors.ink },
});
