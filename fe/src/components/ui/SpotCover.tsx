import { useState, type ReactNode } from "react";
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, space, type } from "@/theme";

/**
 * A spot's cover photo, or a panel that says there is none.
 *
 * The panel is the event detail's hero -- ink, one mark, one muted line --
 * rather than a grey box: an empty box reads as broken, a deliberate panel as
 * "none added yet". A photo that fails to load falls back to the same panel,
 * because a stored URL is no promise the file is still there (local storage
 * inside a rebuilt container lost every upload once already).
 *
 * `children` sit over the image, for badges like distance.
 */
export function SpotCover({
  url,
  style,
  children,
}: {
  url: string | null | undefined;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const showPhoto = !!url && !failed;

  return (
    <View style={[s.frame, style]}>
      {showPhoto ? (
        <Image
          source={{ uri: url }}
          style={s.photo}
          resizeMode="cover"
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={s.empty}>
          <View style={s.sign}>
            <Text style={s.signLetter}>P</Text>
          </View>
          <Text style={s.emptyText}>No photos yet</Text>
        </View>
      )}
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  frame: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: colors.ink,
    overflow: "hidden",
  },
  photo: { width: "100%", height: "100%" },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
  },
  sign: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.inkRaisedBorder,
    backgroundColor: colors.inkRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  signLetter: { fontSize: 24, fontWeight: "700", color: colors.onInk },
  emptyText: { ...type.caption, color: colors.onInkMuted },
});
