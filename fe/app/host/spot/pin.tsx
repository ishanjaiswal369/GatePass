import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Button, MapPinPicker, PhoneFrame, PinIcon } from "@/components/ui";
import { useReverseGeocode } from "@/hooks/useReverseGeocode";
import { useScreenInsets } from "@/hooks/useScreenInsets";
import { deliverPin } from "@/lib/pinHandoff";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space, type } from "@/theme";

/**
 * The map, with the whole screen to itself.
 *
 * Its own route rather than a panel inside the address step: placing a pin on
 * a gate is a job you do with both hands and all the space there is, and a
 * 240px strip between two form fields is not that. The form stays on the
 * stack behind this, so going back returns to it with everything still typed.
 *
 * Nothing is saved here. The point is handed to the address step, which is
 * what writes it -- so backing out of this screen changes nothing.
 *
 * The address under the map is what the pin currently sits on, looked up as it
 * settles. It is shown before saving rather than after so the host can see
 * they have landed on the right place, and it travels back with the pin so the
 * form fills itself in with the address they just agreed to.
 */
export default function PinScreen() {
  const { token, isRestoring } = useSession();
  const insets = useScreenInsets();
  const params = useLocalSearchParams<{ lat?: string; lng?: string }>();

  const [point, setPoint] = useState({
    latitude: Number(params.lat ?? 0),
    longitude: Number(params.lng ?? 0),
  });

  const { address, description, loading } = useReverseGeocode(token, point);

  if (isRestoring) return null;
  if (!token) return <Redirect href="/" />;
  if (!params.lat || !params.lng) return <Redirect href="/host/spot/address" />;

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <View style={[s.header, { paddingTop: insets.top + 16 }]}>
          <Text style={s.title}>Exact parking location</Text>
          <Text style={s.sub}>
            Place the pin exactly where drivers should park. Slide the map so it
            sits on the gate or the bay — not the middle of the building.
          </Text>
        </View>

        {/* No height: it takes what the header and footer leave, and measures
            it, so the controls sit against the edge the host can actually
            see on any screen. */}
        <MapPinPicker
          latitude={point.latitude}
          longitude={point.longitude}
          token={token}
          footer={false}
          onChange={setPoint}
        />

        <View style={[s.footer, { paddingBottom: space.lg + insets.bottom }]}>
          <View style={s.found}>
            <PinIcon color={colors.accent} size={16} />

            <View style={s.foundText}>
              <Text style={s.foundLabel}>This pin is at</Text>

              {description ? (
                <Text style={s.foundAddress} numberOfLines={2}>
                  {description}
                </Text>
              ) : loading ? (
                <View style={s.looking}>
                  <ActivityIndicator size="small" color={colors.inkMuted} />
                  <Text style={s.foundPending}>Looking up the address…</Text>
                </View>
              ) : (
                /* A pin with no address is still a usable pin -- it is what
                   drivers are routed to -- so this is stated rather than
                   treated as something to fix. */
                <Text style={s.foundPending}>
                  No address here. The pin still works; type the address on the
                  next screen.
                </Text>
              )}

              <Text style={s.coords}>
                {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}
              </Text>
            </View>
          </View>

          <Button
            label="Save this location"
            size="lg"
            onPress={() => {
              deliverPin({ ...point, address: address ?? undefined });
              router.back();
            }}
          />
          <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
        </View>
      </View>
    </PhoneFrame>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: 20, paddingBottom: space.lg, gap: 6 },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.ink,
    letterSpacing: -0.4,
  },
  sub: { fontSize: 14, lineHeight: 20, color: colors.inkMuted },
  footer: {
    paddingHorizontal: 20,
    paddingTop: space.lg,
    paddingBottom: space.lg,
    gap: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  found: {
    flexDirection: "row",
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.canvas,
    marginBottom: 4,
  },
  foundText: { flex: 1, gap: 2 },
  foundLabel: { ...type.label, color: colors.inkFaint },
  foundAddress: { fontSize: 14, lineHeight: 19, color: colors.ink, fontWeight: "600" },
  foundPending: { fontSize: 13, lineHeight: 18, color: colors.inkMuted },
  looking: { flexDirection: "row", alignItems: "center", gap: space.sm },
  coords: { ...type.caption, color: colors.inkFaint },
});
