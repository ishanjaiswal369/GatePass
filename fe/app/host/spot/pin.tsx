import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button, MapPinPicker, PhoneFrame } from "@/components/ui";
import { useScreenInsets } from "@/hooks/useScreenInsets";
import { deliverPin } from "@/lib/pinHandoff";
import { useSession } from "@/providers/SessionProvider";
import { colors, space, type } from "@/theme";

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
 */
export default function PinScreen() {
  const { token, isRestoring } = useSession();
  const insets = useScreenInsets();
  const params = useLocalSearchParams<{ lat?: string; lng?: string }>();

  const [point, setPoint] = useState({
    latitude: Number(params.lat ?? 0),
    longitude: Number(params.lng ?? 0),
  });

  if (isRestoring) return null;
  if (!token) return <Redirect href="/" />;
  if (!params.lat || !params.lng) return <Redirect href="/host/spot/address" />;

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <View style={[s.header, { paddingTop: insets.top + 16 }]}>
          <Text style={s.title}>Drop the pin</Text>
          <Text style={s.sub}>
            Slide the map so the pin sits on the gate or entrance drivers should
            head for — not the middle of the building.
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

        <View style={s.footer}>
          <Text style={s.coords}>
            {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}
          </Text>
          <Button
            label="Save this location"
            size="lg"
            onPress={() => {
              deliverPin(point);
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
  coords: { ...type.caption, color: colors.inkFaint, textAlign: "center" },
});
