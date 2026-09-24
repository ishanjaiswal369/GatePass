import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useStaticMap } from "@/hooks/useStaticMap";
import { pixelOffset, zoomToFit } from "@/lib/mercator";
import { colors } from "@/theme";

export interface MapPin {
  id: string;
  latitude: number;
  longitude: number;
  /** What the pin says: a price, usually. */
  label: string;
}

/** The Static Maps API returns at most 640 logical pixels a side. */
const MAX_IMAGE = 640;

/**
 * Where the results are, drawn over one static map image.
 *
 * A flat image with pins placed by projection, for the same reason the pin
 * picker is one: native map views don't run on web and web maps don't run
 * natively. The zoom is chosen to fit every result; tapping a pin selects its
 * card. If the map image can't be had -- no provider configured, or offline --
 * the pins are still placed on a plain ground, so the positions stay useful.
 */
export function ResultsMap({
  token,
  centre,
  pins,
  selectedId,
  onSelect,
  height,
}: {
  token: string | null;
  centre: { latitude: number; longitude: number };
  pins: MapPin[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  height: number;
}) {
  const [width, setWidth] = useState(0);
  /** How far the driver zoomed in (or out) from the fit-everything view. */
  const [nudge, setNudge] = useState(0);
  const imageWidth = Math.min(Math.round(width), MAX_IMAGE);
  const imageHeight = Math.min(height, MAX_IMAGE);
  // Fitting every pin can bunch the near ones on top of each other; the
  // + and - buttons trade the far pins (still in the list) for room.
  const fit = zoomToFit(centre, pins, { width: imageWidth || 360, height: imageHeight }, { min: 11, max: 16 });
  const zoom = Math.min(Math.max(fit + nudge, 11), 17);

  const { uri } = useStaticMap(width > 0 ? token : null, centre, {
    zoom,
    width: Math.max(imageWidth, 100),
    height: imageHeight,
  });

  return (
    <View
      style={[s.frame, { height }]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      accessibilityLabel={`Map of ${pins.length} parking spaces`}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={[s.image, { width: imageWidth, height: imageHeight, marginLeft: -imageWidth / 2, marginTop: -imageHeight / 2 }]}
          resizeMode="cover"
        />
      ) : null}

      {width > 0 ? (
        <>
          <View style={[s.destination, { left: width / 2 - 8, top: height / 2 - 8 }]} />
          {pins.map((pin) => {
            const { dx, dy } = pixelOffset(centre, pin, zoom);
            const on = pin.id === selectedId;
            return (
              <Pressable
                key={pin.id}
                onPress={() => onSelect(pin.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${pin.label}, show this space`}
                hitSlop={6}
                style={[
                  s.pin,
                  on ? s.pinOn : s.pinOff,
                  { left: width / 2 + dx, top: height / 2 + dy, zIndex: on ? 2 : 1 },
                ]}
              >
                <Text style={[s.pinText, on && s.pinTextOn]}>{pin.label}</Text>
              </Pressable>
            );
          })}
          <View style={s.zoomer}>
            <Pressable
              onPress={() => setNudge((n) => n + 1)}
              disabled={zoom >= 17}
              accessibilityRole="button"
              accessibilityLabel="Zoom in"
              style={s.zoomButton}
            >
              <Text style={s.zoomLabel}>+</Text>
            </Pressable>
            <Pressable
              onPress={() => setNudge((n) => n - 1)}
              disabled={zoom <= 11}
              accessibilityRole="button"
              accessibilityLabel="Zoom out"
              style={[s.zoomButton, s.zoomButtonLast]}
            >
              <Text style={s.zoomLabel}>−</Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  frame: { width: "100%", overflow: "hidden", backgroundColor: "#eceee8" },
  image: { position: "absolute", left: "50%", top: "50%" },
  destination: {
    position: "absolute",
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#2563eb",
    borderWidth: 3,
    borderColor: colors.surface,
  },
  pin: {
    position: "absolute",
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 15,
    justifyContent: "center",
    // The point is the pin's bottom centre.
    transform: [{ translateX: "-50%" }, { translateY: -30 }],
    borderWidth: 2,
  },
  pinOff: { backgroundColor: colors.ink, borderColor: colors.surface },
  pinOn: { backgroundColor: colors.surface, borderColor: colors.ink },
  pinText: { fontSize: 12, fontWeight: "700", color: colors.onInk },
  zoomer: {
    position: "absolute",
    right: 10,
    top: 10,
    zIndex: 3,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  zoomButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderBottomWidth: 1, borderBottomColor: colors.border },
  zoomButtonLast: { borderBottomWidth: 0 },
  zoomLabel: { fontSize: 20, fontWeight: "600", color: colors.ink },
  pinTextOn: { color: colors.ink },
});
