import { Redirect, router } from "expo-router";
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
import { TOTAL_STEPS, nextStepPath, stepNumber } from "@/constants/wizard";
import { colors, radius, space, type } from "@/theme";

const MAX_PHOTOS = 8;

/**
 * Step 3. Photos of the space.
 *
 * Each pick uploads immediately rather than batching at Continue: an upload
 * that fails should fail against the one photo that caused it, while the host
 * is still looking at it, not as one opaque error over eight files.
 *
 * The server only ever stores URLs it handed out, so the flow is presign ->
 * PUT -> attach. A URL from anywhere else is refused.
 */
export default function PhotosScreen() {
  const { spot, loading, isRestoring, token } = useSpotDraft();
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

  const { run: remove, busy: removing } = useAsyncAction(async (index: number) => {
    if (!token || !spot) return;

    const next = urls.filter((_, i) => i !== index);
    await spotListingApi.savePhotos(token, spot.id, next);
    setUrls(next);
  });

  if (isRestoring || loading) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;
  if (!spot) return <Redirect href="/host/spot" />;

  return (
    <WizardShell
      title="Photos"
      sub="Show drivers what they are pulling into."
      step={stepNumber("photos")}
      totalSteps={TOTAL_STEPS}
      onBack={() => router.back()}
      onContinue={() => router.push(nextStepPath("photos"))}
      canContinue={urls.length > 0}
      error={uploadError}
      footerNote={
        urls.length === 0 ? "At least one photo is needed." : undefined
      }
    >
      <Text style={s.hint}>
        The first photo is the one drivers see in search. A wide shot of the
        entrance helps more than a close-up of the floor.
      </Text>

      <View style={s.grid}>
        {urls.map((url, index) => (
          <View key={url} style={s.tile}>
            <Image source={{ uri: url }} style={s.image} resizeMode="cover" />

            {index === 0 ? (
              <View style={s.coverBadge}>
                <Text style={s.coverText}>Cover</Text>
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
        {urls.length} of {MAX_PHOTOS}
      </Text>
    </WizardShell>
  );
}

const s = StyleSheet.create({
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
