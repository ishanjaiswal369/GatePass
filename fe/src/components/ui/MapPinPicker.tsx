import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
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
import type { MapType } from "@/types/api.types";

/**
 * The image is fetched larger than the frame, and the extra is what the map
 * slides on. Without the margin a drag would pull blank edges into view before
 * the next image arrived. 640 is the most the Static Maps API will return.
 */
const IMAGE_WIDTH = 640;
const IMAGE_HEIGHT = 640;

const MIN_ZOOM = 16;
const MAX_ZOOM = 21;

const MAP_TYPES: { value: MapType; label: string }[] = [
  { value: "roadmap", label: "Map" },
  { value: "hybrid", label: "Satellite" },
];

/**
 * Pick an exact point by sliding a map under a fixed pin.
 *
 * The pin does not move; the map does. That is the arrangement every maps app
 * uses for this, and it is the honest one: the thing being chosen is the
 * centre of the view, so it should sit in the middle and stay there rather
 * than wander towards an edge.
 *
 * A flat image rather than a real map view, because the app runs on web and on
 * a phone from one codebase and the map libraries that pan and zoom natively
 * do not: react-native-maps has no web support, Google's JavaScript map has no
 * native one. 3D is out for the same reason, and would make this harder
 * anyway -- on a tilted view a screen pixel no longer maps to one point on the
 * ground, and buildings hide the ground you are aiming at.
 *
 * The maths lives in lib/mercator.
 */
export function MapPinPicker({
  latitude,
  longitude,
  onChange,
  token,
  height,
  footer,
}: {
  latitude: number;
  longitude: number;
  onChange: (next: { latitude: number; longitude: number }) => void;
  token: string | null;
  /**
   * Frame height. Omit it to fill whatever the parent gives, which is what a
   * full screen wants -- a number computed from the window is guesswork, and
   * when it guesses high the frame is squeezed by flex while its absolutely
   * positioned controls stay where the number put them, off the bottom edge.
   */
  height?: number;
  /** false on a full screen, where the surrounding screen carries the copy. */
  footer?: boolean;
}) {
  /** What the frame actually measured, which is the only size worth trusting. */
  const [frame, setFrame] = useState({ width: 0, height: 0 });

  const marginX = Math.max((IMAGE_WIDTH - frame.width) / 2, 0);
  const marginY = Math.max((IMAGE_HEIGHT - frame.height) / 2, 0);
  const [zoom, setZoom] = useState(18);
  const [mapType, setMapType] = useState<MapType>("roadmap");

  /** Centre of the image being fetched or shown. */
  const [centre, setCentre] = useState({ latitude, longitude });

  const { uri, failed, attempt } = useStaticMap(token, centre, {
    zoom,
    width: IMAGE_WIDTH,
    height: IMAGE_HEIGHT,
    mapType,
  });

  /**
   * How far the map has been slid from the centre it was fetched for.
   *
   * An Animated value rather than state: this changes on every pointer move,
   * and running React through a render on each one is what makes a drag feel
   * heavy. Animated writes straight to the view.
   */
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  /** The same numbers, readable synchronously by the responder. */
  const slid = useRef({ x: 0, y: 0 });
  const grabbedAt = useRef({ x: 0, y: 0 });

  /**
   * How much of the slide has already been folded into `centre`.
   *
   * The two numbers move at different moments and that is the whole point.
   * `slid` is what the map is showing, and it cannot be cleared on release --
   * the image on screen is still the old one, and zeroing it there would make
   * the map jump back before the new picture replaced it. `centre` moves on
   * release, though, so everything up to `applied` has already been paid for.
   * Settling the difference rather than the total is what keeps a second drag
   * from re-applying the first: without it a drag after a map image failed to
   * load moved the pin twice as far as the host dragged it, then three times,
   * and so on.
   */
  const applied = useRef({ x: 0, y: 0 });

  const emitted = useRef<{ latitude: number; longitude: number } | null>(null);
  /** The fetch whose outcome the slide has already been reset for. */
  const reset = useRef(0);

  const live = useRef({ centre, zoom });
  live.current = { centre, zoom };

  const report = (point: { latitude: number; longitude: number }) => {
    emitted.current = point;
    onChange(point);
  };

  // A pick from the search box replaces the point outright. Its own echo is
  // ignored, or the map would jump back to centre after every slide.
  useEffect(() => {
    const echo =
      emitted.current !== null &&
      Math.abs(emitted.current.latitude - latitude) < 1e-9 &&
      Math.abs(emitted.current.longitude - longitude) < 1e-9;

    if (echo) return;

    setCentre({ latitude, longitude });
    slid.current = { x: 0, y: 0 };
    applied.current = { x: 0, y: 0 };
    pan.setValue({ x: 0, y: 0 });
  }, [latitude, longitude, pan]);

  /**
   * Snap the slide back to zero once the fetch for the new centre is done.
   *
   * Done on arrival rather than on release because the new image is centred
   * where the old one was dragged to: swapping it in and zeroing the offset in
   * the same moment leaves the view exactly where the finger left it. Zeroing
   * earlier would show the old image jump back before the new one replaced it.
   *
   * On the attempt rather than on the URI, so a fetch that came back with
   * nothing still clears the slide. Watching the URI alone meant that with map
   * images failing -- an API key without the Static Maps API on it, say -- the
   * offset was never cleared and each drag replayed every drag before it.
   */
  useEffect(() => {
    if (attempt === 0 || reset.current === attempt) return;

    reset.current = attempt;
    slid.current = { x: 0, y: 0 };
    applied.current = { x: 0, y: 0 };
    pan.setValue({ x: 0, y: 0 });
  }, [attempt, pan]);

  /**
   * Turns where the map was left into the point under the pin.
   *
   * Runs on release and on terminate: a gesture that is taken away mid-drag
   * still moved the map, and the host still means what they see.
   */
  const settle = () => {
    const { centre: from, zoom: atZoom } = live.current;

    // Only the part of the slide that has not been turned into a centre yet.
    // Release and terminate both fire for one gesture, and a second drag can
    // start before the image for the first has landed; in either case this is
    // zero the second time round, which is exactly the right answer.
    const dx = slid.current.x - applied.current.x;
    const dy = slid.current.y - applied.current.y;

    if (dx === 0 && dy === 0) return;
    applied.current = { ...slid.current };

    // The map moved right, so the point under the pin moved left: the centre
    // shifts against the drag, not with it.
    const point = offsetByPixels(from, { dx: -dx, dy: -dy }, atZoom);

    report(point);
    setCentre(point);
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        // A touch alone is not a drag. Claiming the gesture on touch-down
        // swallows taps meant for the zoom and map-type buttons sitting over
        // the frame -- and each swallowed tap ended as a release that applied
        // the last slide a second time.
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,

        // gesture.dx is measured from the start of the gesture, so it is added
        // to where the map was when the finger went down, never to where it is
        // now -- that would compound on every event and the map would race
        // away from the finger.
        onPanResponderGrant: () => {
          grabbedAt.current = { ...slid.current };
        },

        onPanResponderMove: (_event, gesture) => {
          const x = clamp(grabbedAt.current.x + gesture.dx, marginX);
          const y = clamp(grabbedAt.current.y + gesture.dy, marginY);

          slid.current = { x, y };
          pan.setValue({ x, y });
        },

        // Nothing else may take the gesture mid-drag. Without this the
        // scroll view above can claim it, and the drag ends in a terminate
        // that never settles the new centre -- the map slides and then
        // silently forgets where it was put.
        onPanResponderTerminationRequest: () => false,

        onPanResponderRelease: settle,
        onPanResponderTerminate: settle,
      }),
    [onChange, pan, marginX, marginY]
  );

  const changeZoom = (by: number) => {
    const next = Math.min(Math.max(zoom + by, MIN_ZOOM), MAX_ZOOM);
    if (next === zoom) return;
    setZoom(next);
  };

  const across = Math.round(
    (frame.width || IMAGE_WIDTH) * metresPerPixel(centre.latitude, zoom)
  );

  return (
    <View style={[s.wrap, footer === false && s.wrapBare]}>
      <View
        style={[s.frame, height === undefined ? s.frameFill : { height }]}
        onLayout={(event) => {
          const { width: w, height: h } = event.nativeEvent.layout;
          // Only when it actually changes, or this re-renders on every frame
          // of a drag.
          setFrame((current) =>
            Math.abs(current.width - w) < 1 && Math.abs(current.height - h) < 1
              ? current
              : { width: w, height: h }
          );
        }}
        {...responder.panHandlers}
      >
        <Animated.View
          style={[
            s.sheet,
            { left: -marginX, top: -marginY },
            { transform: [{ translateX: pan.x }, { translateY: pan.y }] },
          ]}
        >
          {uri ? (
            <Image source={{ uri }} style={s.image} resizeMode="cover" />
          ) : (
            <View style={[s.image, s.placeholder]}>
              {failed ? (
                <Text style={s.placeholderText}>
                  Map preview unavailable — the pin still works.
                </Text>
              ) : (
                <ActivityIndicator color={colors.inkMuted} />
              )}
            </View>
          )}
        </Animated.View>

        {/* Fixed in the middle. What the pin covers is what gets saved, so it
            never moves -- the map does. */}
        <View style={s.pin}>
          <View style={s.pinHead} />
          <View style={s.pinStem} />
        </View>
        <View style={s.target} />

        <View style={s.types}>
          {MAP_TYPES.map((option) => (
            <Pressable
              key={option.value}
              onPress={() => setMapType(option.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: mapType === option.value }}
              style={[s.typeButton, mapType === option.value && s.typeOn]}
            >
              <Text
                style={[s.typeLabel, mapType === option.value && s.typeLabelOn]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>

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

      {footer === false ? null : (
        <View style={s.footer}>
          <Text style={s.hint}>
            Slide the map so the pin sits on the gate or entrance drivers should
            head for.
          </Text>
          <Text style={s.scale}>
            About {across}m across · {latitude.toFixed(5)}, {longitude.toFixed(5)}
          </Text>
        </View>
      )}
    </View>
  );
}

/** Keeps the slide within the margin the oversized image gives us. */
function clamp(value: number, limit: number): number {
  return Math.max(Math.min(value, limit), -limit);
}

const s = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.surface,
  },
  wrapBare: { borderWidth: 0, borderRadius: 0, flex: 1 },
  frameFill: { flex: 1 },
  frame: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.canvas,
    overflow: "hidden",
  },
  // Centred on the frame and larger than it, so there is map to slide onto.
  sheet: {
    position: "absolute",
    width: IMAGE_WIDTH,
    height: IMAGE_HEIGHT,
  },
  image: { width: "100%", height: "100%" },
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
    padding: space.lg,
    backgroundColor: colors.canvas,
  },
  placeholderText: {
    ...type.caption,
    color: colors.inkMuted,
    textAlign: "center",
  },
  pin: {
    position: "absolute",
    alignItems: "center",
    pointerEvents: "none",
    transform: [{ translateY: -14 }],
  },
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
  types: { position: "absolute", left: 10, bottom: 10, flexDirection: "row", gap: 6 },
  typeButton: {
    paddingHorizontal: 12,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  typeOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  typeLabel: { fontSize: 12, fontWeight: "600", color: colors.ink },
  typeLabelOn: { color: colors.onInk },
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
