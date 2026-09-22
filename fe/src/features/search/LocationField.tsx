import { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { spotsApi } from "@/api";
import { CheckIcon, Field, PinIcon } from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useDriverLocation } from "@/hooks/useDriverLocation";
import { usePlaceSearch } from "@/hooks/usePlaceSearch";
import type { SearchPlace } from "@/lib/searchCriteria";
import { colors, radius, space, type } from "@/theme";
import type { PlaceSuggestion } from "@/types/api.types";

/**
 * Where the driver wants to park.
 *
 * Two ways in, because neither covers everyone. Current location is one tap
 * and is what a driver already standing somewhere wants; typing an area is
 * what someone planning tomorrow's trip wants, and is the only route left once
 * location has been refused -- a refusal the OS will not re-prompt for.
 *
 * Permission is asked on the button press, never on mount. A cold prompt with
 * no visible reason gets denied, and a denial is far harder to undo than a
 * delay.
 *
 * This uses the type-ahead (`usePlaceSearch`) rather than a plain geocode of
 * whatever was typed: the same control the host wizard uses, billed as one
 * session per search instead of one request per keystroke.
 */
export function LocationField({
  token,
  place,
  onChange,
}: {
  token: string | null;
  place: SearchPlace | null;
  onChange: (next: SearchPlace) => void;
}) {
  const { requestLocation } = useDriverLocation();
  const {
    query,
    setQuery,
    results,
    searching,
    unavailableReason,
    settle,
    sessionToken,
  } = usePlaceSearch(token);

  /**
   * Names a point, so the chosen place reads as somewhere rather than as a
   * pair of numbers. Advisory: the coordinates are what the search actually
   * uses, so a failed lookup still leaves a usable place.
   */
  const nameFor = useCallback(
    async (latitude: number, longitude: number): Promise<string> => {
      if (!token) return "Current location";

      try {
        const { result } = await spotsApi.reverseGeocode(token, latitude, longitude);
        return result.address?.addressLine ?? result.description ?? "Current location";
      } catch {
        return "Current location";
      }
    },
    [token]
  );

  const { run: useMyLocation, busy: locating, error: locationError } =
    useAsyncAction(async () => {
      const at = await requestLocation();

      if (!at) {
        throw new Error(
          "Location is off. Search for an area below instead."
        );
      }

      onChange({
        latitude: at.latitude,
        longitude: at.longitude,
        label: await nameFor(at.latitude, at.longitude),
      });
    });

  const { run: pick, busy: resolving, error: pickError } = useAsyncAction(
    async (result: PlaceSuggestion) => {
      const carriedSession = sessionToken();
      settle(result.description);

      if (result.latitude !== undefined && result.longitude !== undefined) {
        onChange({
          latitude: result.latitude,
          longitude: result.longitude,
          label: result.description,
        });
        return;
      }

      if (!token || !result.providerPlaceId) return;

      // Only the row the driver actually chose costs a details lookup;
      // resolving every suggestion would bill for the ones they ignored.
      const { result: full } = await spotsApi.placeDetails(
        token,
        result.providerPlaceId,
        { sessionToken: carriedSession }
      );

      onChange({
        latitude: full.latitude,
        longitude: full.longitude,
        label: result.description,
      });
    }
  );

  const error = locationError ?? pickError;

  return (
    <View style={s.wrap}>
      <Pressable
        onPress={useMyLocation}
        disabled={locating}
        accessibilityRole="button"
        style={({ pressed }) => [s.locate, pressed && s.locatePressed]}
      >
        <PinIcon color={colors.ink} size={16} />
        <Text style={s.locateLabel}>
          {locating ? "Finding you…" : "Use my current location"}
        </Text>
      </Pressable>

      <Field
        label="Or search an area"
        value={query}
        onChangeText={setQuery}
        placeholder="Kothrud, Pune"
        autoCorrect={false}
        icon={<PinIcon color={colors.inkFaint} size={18} />}
        hint={
          unavailableReason
            ? unavailableReason
            : resolving
              ? "Getting the location…"
              : searching
                ? "Searching…"
                : undefined
        }
      />

      {results.length > 0 ? (
        <View style={s.results}>
          {results.map((result, index) => (
            <Pressable
              key={result.providerPlaceId ?? result.description}
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

      {error ? <Text style={s.error}>{error}</Text> : null}

      {place ? (
        <View style={s.chosen}>
          <CheckIcon color={colors.success} size={14} />
          <Text style={s.chosenText} numberOfLines={2}>
            {place.label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: space.md },
  locate: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    minHeight: 46,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.canvas,
  },
  locatePressed: { backgroundColor: colors.border },
  locateLabel: { fontSize: 14, fontWeight: "600", color: colors.ink },
  results: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    overflow: "hidden",
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
  resultText: { flex: 1, fontSize: 14, color: colors.ink },
  error: { ...type.caption, color: colors.danger, lineHeight: 17 },
  chosen: { flexDirection: "row", alignItems: "center", gap: space.sm },
  chosenText: { flex: 1, fontSize: 13, fontWeight: "600", color: colors.ink },
});
