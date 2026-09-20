import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useStaticMap } from "@/hooks/useStaticMap";
import { metresPerPixel, offsetByPixels } from "@/lib/mercator";
import { colors, radius, space, type } from "@/theme";

const MAP_WIDTH = 400;
const MAP_HEIGHT = 240;
const MIN_ZOOM = 16;
const MAX_ZOOM = 21;

/**
 * How far the pin may drift from the centre before the map recentres under it.
 *
 * Recentring costs an image, so it is not done on every drag; but a pin parked
 * against the edge has nowhere left to go, which is worse.
 */
const RECENTRE_AT = 0.38;

/**
 * Pick an exact point by dragging a pin over a map image.
 *
 * A flat image with a draggable pin rather than a real map view, because the
 * app runs on web and on a phone from one codebase and the map libraries that
 * do pan and zoom natively do not: react-native-maps has no web support, and
 * Google's JavaScript map has no native one. The job here is small enough not
 * to need them -- a host is moving a pin from their building's address to
 * their gate, tens of metres away, not exploring.
 *
 * The maths lives in lib/mercator. Only the drag, the recentring and the
 * zoom buttons are here.
 */
export function MapPinPicker({
  latitude,
  longitude,
  onChange,
  token,
}: {
  latitude: number;
  longitude: number;
  onChange: (next: { latitude: number; longitude: number }) => void;
  token: string | null;
}) {
  const [zoom, setZoom] = useState(18);
  // What the image is centred on. Follows the pin, but only when the pin gets
  // close enough to an edge to need it.
  const [centre, setCentre] = useState({ latitude, longitude });
  // Pin position as an offset in logical pixels from the centre of the image.
  const [offset, setOffset] = useState({ dx: 0, dy: 0 });

  const { uri, failed } = useStaticMap(token, centre, {
    zoom,
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
  });

  // Everything the responder needs without re-creating it on each render,
  // which would drop a drag half way through.
  const live = useRef({ centre, offset, zoom });
  live.current = { centre, offset, zoom };

  // The last point this component reported upwards.
  //
  // Needed because onChange flows back down as new props, and without it the
  // effect below could not tell a fresh pick from the search box apart from
  // the echo of the drag that just happened -- so every drag recentred the
  // map and fetched another image, which is another billed request and a pin
  // that jumps back to the middle mid-adjustment.
  const emitted = useRef<{ latitude: number; longitude: number } | null>(null);
  /** Pin offset at the moment the current drag started. */
  const grabbedAt = useRef({ dx: 0, dy: 0 });

  const report = (point: { latitude: number; longitude: number }) => {
    emitted.current = point;
    onChange(point);
  };

  // A pick from the search box replaces the point outright, so the image
  // recentres and the pin returns to the middle.
  useEffect(() => {
    const echo =
      emitted.current !== null &&
      Math.abs(emitted.current.latitude - latitude) < 1e-9 &&
      Math.abs(emitted.current.longitude - longitude) < 1e-9;

    if (echo) return;

    setCentre({ latitude, longitude });
    setOffset({ dx: 0, dy: 0 });
  }, [latitude, longitude]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,

        // Where the pin was when this gesture began.
        //
        // gesture.dx is measured from the start of the gesture, not since the
        // last event, so it has to be added to a fixed base. Adding it to the
        // current offset instead compounds it on every move -- the pin then
        // runs away from the finger and a short drag reads as a long one.
        onPanResponderGrant: () => {
          grabbedAt.current = live.current.offset;
        },

        onPanResponderMove: (_event, gesture) => {
          const base = grabbedAt.current;
          setOffset({
            dx: clamp(base.dx + gesture.dx, MAP_WIDTH / 2),
            dy: clamp(base.dy + gesture.dy, MAP_HEIGHT / 2),
          });
        },

        onPanResponderRelease: (_event, gesture) => {
          const { centre: from, zoom: atZoom } = live.current;
          const base = grabbedAt.current;
          const next = {
            dx: clamp(base.dx + gesture.dx, MAP_WIDTH / 2),
            dy: clamp(base.dy + gesture.dy, MAP_HEIGHT / 2),
          };

          setOffset(next);

          const point = offsetByPixels(from, next, atZoom);
          report(point);

          // Far enough out that the next drag would hit the edge: put the pin
          // back in the middle and fetch the square around it.
          const drifted =
            Math.abs(next.dx) > MAP_WIDTH * RECENTRE_AT ||
            Math.abs(next.dy) > MAP_HEIGHT * RECENTRE_AT;

          if (drifted) {
            setCentre(point);
            setOffset({ dx: 0, dy: 0 });
          }
        },
      }),
    [onChange]
  );

  const changeZoom = (by: number) => {
    const next = Math.min(Math.max(zoom + by, MIN_ZOOM), MAX_ZOOM);
    if (next === zoom) return;

    // Zooming about the pin, not the old centre, so the thing being aimed at
    // stays under the finger.
    const point = offsetByPixels(centre, offset, zoom);
    setCentre(point);
    setOffset({ dx: 0, dy: 0 });
    setZoom(next);
    report(point);
  };

  const across = Math.round(MAP_WIDTH * metresPerPixel(centre.latitude, zoom));

  return (
    <View style={s.wrap}>
      <View style={s.frame} {...responder.panHandlers}>
        {uri ? (
          <Image source={{ uri }} style={s.image} resizeMode="cover" />
        ) : (
          <View style={[s.image, s.placeholder]}>
            {failed ? (
              <Text style={s.placeholderText}>
                Map preview unavailable — the pin below still works.
              </Text>
            ) : (
              <ActivityIndicator color={colors.inkMuted} />
            )}
          </View>
        )}

        {/* The pin, and a dot at its point so it is obvious which pixel is
            being chosen rather than roughly where the graphic sits. */}
        <View
          style={[
            s.pin,
            {
              transform: [
                { translateX: offset.dx },
                { translateY: offset.dy - 14 },
              ],
            },
          ]}
        >
          <View style={s.pinHead} />
          <View style={s.pinStem} />
        </View>
        <View
          style={[
            s.target,
            { transform: [{ translateX: offset.dx }, { translateY: offset.dy }] },
          ]}
        />

        <View style={s.zoomer}>
          <Pressable
            onPress={() => changeZoom(1)}
            disabled={zoom >= MAX_ZOOM}
            accessibilityRole="button"
            accessibilityLabel="Zoom in"
            style={({ pressed }) => [s.zoomButton, pressed && s.zoomPressed]}
          >
            <Text style={s.zoomLabel}>+</Text>
          </Pressable>
          <Pressable
            onPress={() => changeZoom(-1)}
            disabled={zoom <= MIN_ZOOM}
            accessibilityRole="button"
            accessibilityLabel="Zoom out"
            style={({ pressed }) => [s.zoomButton, pressed && s.zoomPressed]}
          >
            <Text style={s.zoomLabel}>−</Text>
          </Pressable>
        </View>
      </View>

      <View style={s.footer}>
        <Text style={s.hint}>
          Drag the pin onto the gate or entrance drivers should head for.
        </Text>
        <Text style={s.scale}>
          About {across}m across · {latitude.toFixed(5)}, {longitude.toFixed(5)}
        </Text>
      </View>
    </View>
  );
}

/** Keeps the pin inside the picture it is being dragged over. */
function clamp(value: number, limit: number): number {
  return Math.max(Math.min(value, limit - 16), -(limit - 16));
}

const s = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.surface,
  },
  frame: {
    height: MAP_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.canvas,
  },
  image: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  placeholder: { alignItems: "center", justifyContent: "center", padding: space.lg },
  placeholderText: {
    ...type.caption,
    color: colors.inkMuted,
    textAlign: "center",
  },
  // pointerEvents lives in style, not as a prop: the prop is deprecated and
  // warns on every render. The pin must not take the touch -- the frame\'s
  // responder is what tracks the drag.
  pin: { position: "absolute", alignItems: "center", pointerEvents: "none" },
  pinHead: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accent,
    borderWidth: 3,
    borderColor: colors.onInk,
  },
  pinStem: {
    width: 2,
    height: 10,
    backgroundColor: colors.accent,
    marginTop: -1,
  },
  target: {
    position: "absolute",
    pointerEvents: "none",
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.ink,
    borderWidth: 1,
    borderColor: colors.onInk,
  },
  zoomer: { position: "absolute", right: 10, bottom: 10, gap: 6 },
  zoomButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  zoomPressed: { backgroundColor: colors.border },
  zoomLabel: { fontSize: 18, fontWeight: "600", color: colors.ink, lineHeight: 20 },
  footer: {
    padding: space.lg,
    gap: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  hint: { fontSize: 13, lineHeight: 18, color: colors.ink },
  scale: { ...type.caption, color: colors.inkFaint },
});
