import { Redirect } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { spotListingApi } from "@/api";
import {
  RestoringScreen,
  TrashIcon,
  WizardShell,
} from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { useWizardBack } from "@/hooks/useWizardBack";
import { useWizardContinue } from "@/hooks/useWizardContinue";
import {
  TOTAL_STEPS,
  firstStepPath,
  stepNumber,
} from "@/constants/wizard";
import { colors, radius, space, type } from "@/theme";

const MAX_PHOTOS = 8;
/** The fewest a listing is reviewed (or stays live) with; the API enforces it too. */
const MIN_PHOTOS = 2;

/** Shots that answer a driver's questions, suggested rather than required. */
const SUGGESTED = ["The parking space itself", "The entrance or gate", "The approach road", "The building or a landmark nearby"];

/**
 * Step 3. Photos of the space.
 *
 * Each pick uploads immediately rather than batching at Continue: an upload
 * that fails should fail against the one photo that caused it, while the host
 * is still looking at it, not as one opaque error over eight files.
 *
 * The server only ever stores URLs it handed out, so the flow is presign ->
 * PUT -> attach. A URL from anywhere else is refused.
 *
 * Order is the list order and the first photo is the cover, so moving a
 * photo and making it the cover are the same save: the new order.
 */
export default function PhotosScreen() {
  const { spot, loading, isRestoring, token } = useSpotDraft();
  const back = useWizardBack("photos", spot?.id);
  const proceed = useWizardContinue("photos");
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    if (!spot) return;
    setUrls(spot.photos.map((photo) => photo.url));
  }, [spot]);

  const { run: add, busy: uploading, error: uploadError } = useAsyncAction(
    async () => {
      if (!token || !spot) return;

      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
        allowsMultipleSelection: true,
        selectionLimit: MAX_PHOTOS - urls.length,
      });

      if (picked.canceled) return;

      const uploaded: string[] = [];

      for (const asset of picked.assets) {
        // fetch()+blob() rather than the file URI: this is what works the
        // same on web and native, and the PUT needs the bytes either way.
        const blob = await (await fetch(asset.uri)).blob();

        const presigned = await spotListingApi.presignPhoto(token, spot.id, {
          contentType: blob.type || "image/jpeg",
          contentLength: blob.size,
        });

        uploaded.push(await spotListingApi.uploadFile(presigned, blob));
      }

      const next = [...urls, ...uploaded].slice(0, MAX_PHOTOS);
      await spotListingApi.savePhotos(token, spot.id, next);
      setUrls(next);
    }
  );

  const { run: reorder, busy: removing, error: orderError } = useAsyncAction(async (next: string[]) => {
    if (!token || !spot) return;
    await spotListingApi.savePhotos(token, spot.id, next);
    setUrls(next);
  });

  const remove = (index: number) => reorder(urls.filter((_, i) => i !== index));
  const move = (index: number, by: -1 | 1) => {
    const next = [...urls];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    void reorder(next);
  };
  const makeCover = (index: number) => reorder([urls[index], ...urls.filter((_, i) => i !== index)]);

  if (isRestoring || loading) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;
  if (!spot) return <Redirect href={firstStepPath()} />;

  return (
    <WizardShell
      title="Photos"
      sub="Show drivers what they are pulling into."
      step={stepNumber("photos")}
      totalSteps={TOTAL_STEPS}
      onBack={back}
      onContinue={() => proceed(spot)}
      canContinue={urls.length >= MIN_PHOTOS && !uploading}
      error={uploadError ?? orderError}
      footerNote={
        urls.length === 0
          ? `Add at least ${MIN_PHOTOS} photos.`
          : urls.length < MIN_PHOTOS
            ? "Add at least one more photo."
            : undefined
      }
    >
      <Text style={s.hint}>
        The first photo is the cover — the one drivers see in search. Show the actual parking space clearly; avoid
        blurry or unrelated images.
      </Text>

      <View style={s.suggest}>
        <Text style={s.suggestTitle}>Photos that help drivers</Text>
        {SUGGESTED.map((item) => (
          <Text key={item} style={s.suggestItem}>
            • {item}
          </Text>
        ))}
      </View>

      <View style={s.grid}>
        {urls.map((url, index) => (
          <View key={url} style={s.tile}>
            <Image source={{ uri: url }} style={s.image} resizeMode="cover" />

            {index === 0 ? (
              <View style={s.coverBadge}>
                <Text style={s.coverText}>Cover photo</Text>
              </View>
            ) : null}

            <Pressable
              onPress={() => remove(index)}
              disabled={removing}
              accessibilityRole="button"
              accessibilityLabel={`Remove photo ${index + 1}`}
              style={s.remove}
            >
              <TrashIcon color={colors.onInk} size={14} />
            </Pressable>

            <View style={s.tools}>
              <TileButton label="‹" a11y={`Move photo ${index + 1} earlier`} disabled={index === 0 || removing} onPress={() => move(index, -1)} />
              {index > 0 ? (
                <TileButton label="Set cover" a11y={`Make photo ${index + 1} the cover`} disabled={removing} onPress={() => makeCover(index)} wide />
              ) : (
                <View style={s.flex} />
              )}
              <TileButton
                label="›"
                a11y={`Move photo ${index + 1} later`}
                disabled={index === urls.length - 1 || removing}
                onPress={() => move(index, 1)}
              />
            </View>
          </View>
        ))}

        {urls.length < MAX_PHOTOS ? (
          <Pressable
            onPress={add}
            disabled={uploading}
            accessibilityRole="button"
            accessibilityLabel="Add a photo"
            style={({ pressed }) => [s.tile, s.addTile, pressed && s.addPressed]}
          >
            <Text style={s.addPlus}>+</Text>
            <Text style={s.addLabel}>
              {uploading ? "Uploading…" : "Add photo"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={s.counter}>
        {urls.length} of {MAX_PHOTOS} · at least {MIN_PHOTOS}
      </Text>
    </WizardShell>
  );
}

/** A small control on a photo: move it, or make it the cover. */
function TileButton({
  label,
  a11y,
  onPress,
  disabled,
  wide,
}: {
  label: string;
  a11y: string;
  onPress: () => void;
  disabled?: boolean;
  wide?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: !!disabled }}
      aria-disabled={!!disabled}
      hitSlop={6}
      style={[s.toolButton, wide && s.toolWide, disabled && s.toolOff]}
    >
      <Text style={[s.toolText, !wide && s.toolArrow]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  suggest: {
    gap: 2,
    backgroundColor: colors.canvas,
    borderRadius: radius.md,
    padding: space.md,
  },
  suggestTitle: { ...type.label, color: colors.ink, marginBottom: 2 },
  suggestItem: { fontSize: 13, lineHeight: 19, color: colors.inkMuted },
  tools: {
    position: "absolute",
    left: 6,
    right: 6,
    bottom: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  toolButton: {
    minWidth: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(17,24,39,0.82)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  toolWide: { flex: 1 },
  toolOff: { opacity: 0.35 },
  toolText: { fontSize: 12, fontWeight: "700", color: colors.onInk },
  toolArrow: { fontSize: 18, lineHeight: 20 },
  hint: { ...type.caption, color: colors.inkMuted, lineHeight: 18 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  tile: {
    width: "47%",
    aspectRatio: 4 / 3,
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: colors.border,
  },
  image: { width: "100%", height: "100%" },
  coverBadge: {
    position: "absolute",
    left: 8,
    top: 8,
    backgroundColor: colors.ink,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  coverText: { fontSize: 11, fontWeight: "600", color: colors.onInk },
  remove: {
    position: "absolute",
    right: 8,
    top: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  addTile: {
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.borderStrong,
  },
  addPressed: { backgroundColor: colors.canvas },
  addPlus: { fontSize: 26, color: colors.inkMuted, lineHeight: 30 },
  addLabel: { ...type.caption, color: colors.inkMuted },
  counter: { ...type.caption, color: colors.inkFaint },
});
