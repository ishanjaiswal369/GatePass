import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { spotListingApi } from "@/api";
import {
  CameraIcon,
  PlusIcon,
  RequiredLabel,
  RestoringScreen,
  TrashIcon,
  WizardShell,
} from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { useWizardBack } from "@/hooks/useWizardBack";
import { useWizardContinue } from "@/hooks/useWizardContinue";
import { pickImages } from "@/lib/pickImages";
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
  /** Which of the picked photos is going up, for "Uploading 2 of 3…". */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    if (!spot) return;
    setUrls(spot.photos.map((photo) => photo.url));
  }, [spot]);

  const { run: add, busy: uploading, error: uploadError } = useAsyncAction(
    async () => {
      if (!token || !spot) return;

      const picked = await pickImages({ multiple: true, limit: MAX_PHOTOS - urls.length, quality: 0.8 });
      if (!picked) return;

      const batch = picked.slice(0, MAX_PHOTOS - urls.length);
      const uploaded: string[] = [];

      try {
        for (const image of batch) {
          setProgress({ done: uploaded.length, total: batch.length });
          const presigned = await spotListingApi.presignPhoto(token, spot.id, {
            contentType: image.contentType,
            contentLength: image.size,
          });

          uploaded.push(await spotListingApi.uploadFile(presigned, image.blob));
        }
      } finally {
        // Photos that made it up before a failure are kept, not thrown away
        // with the one that failed.
        if (uploaded.length > 0) {
          const next = [...urls, ...uploaded].slice(0, MAX_PHOTOS);
          await spotListingApi.savePhotos(token, spot.id, next);
          setUrls(next);
        }
        setProgress(null);
      }
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
      <View style={s.head}>
        <View style={s.headRow}>
          <RequiredLabel style={s.headTitle} header>
            Your photos
          </RequiredLabel>
          <Text style={[s.count, urls.length >= MIN_PHOTOS && s.countDone]}>
            {urls.length}/{MAX_PHOTOS}
          </Text>
        </View>
        <Text style={s.hint}>
          At least {MIN_PHOTOS}. The first one is the cover drivers see in search. Large photos are resized for you.
        </Text>
      </View>

      {urls.length === 0 ? (
        // Nothing yet: one big, obvious target instead of a small box in a grid.
        <Pressable
          onPress={add}
          disabled={uploading}
          accessibilityRole="button"
          accessibilityLabel="Add photos"
          style={({ pressed }) => [s.dropZone, pressed && s.addPressed]}
        >
          {uploading ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            <View style={s.dropIcon}>
              <CameraIcon color={colors.ink} size={26} />
            </View>
          )}
          <Text style={s.dropTitle}>{uploading ? uploadLabel(progress) : "Add photos"}</Text>
          {uploading ? null : <Text style={s.dropSub}>Choose up to {MAX_PHOTOS} from your gallery</Text>}
        </Pressable>
      ) : null}

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

        {urls.length > 0 && urls.length < MAX_PHOTOS ? (
          <Pressable
            onPress={add}
            disabled={uploading}
            accessibilityRole="button"
            accessibilityLabel="Add more photos"
            style={({ pressed }) => [s.tile, s.addTile, pressed && s.addPressed]}
          >
            {uploading ? (
              <ActivityIndicator color={colors.ink} />
            ) : (
              <View style={s.addIcon}>
                <PlusIcon color={colors.onInk} size={18} />
              </View>
            )}
            <Text style={s.addLabel}>{uploading ? uploadLabel(progress) : "Add more"}</Text>
            {uploading ? null : <Text style={s.addSub}>{MAX_PHOTOS - urls.length} left</Text>}
          </Pressable>
        ) : null}
      </View>

      <View style={s.suggest}>
        <Text style={s.suggestTitle}>Photos that help drivers</Text>
        {SUGGESTED.map((item) => (
          <Text key={item} style={s.suggestItem}>
            • {item}
          </Text>
        ))}
        <Text style={s.suggestNote}>Show the actual space clearly; avoid blurry or unrelated images.</Text>
      </View>
    </WizardShell>
  );
}

/** Picking and resizing come before the first upload, so there's no count yet. */
function uploadLabel(progress: { done: number; total: number } | null): string {
  if (!progress) return "Preparing…";
  return progress.total > 1 ? `Uploading ${progress.done + 1} of ${progress.total}…` : "Uploading…";
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
  suggestNote: { ...type.caption, color: colors.inkFaint, marginTop: space.xs },
  head: { gap: space.xs },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headTitle: { fontSize: 16, fontWeight: "700", color: colors.ink },
  count: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.inkMuted,
    backgroundColor: colors.canvas,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    overflow: "hidden",
  },
  countDone: { color: "#166534", backgroundColor: "#dcfce7" },
  // Grey dashes on a tinted ground: an empty slot, not a black-outlined box.
  dropZone: {
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    paddingVertical: space.xl + space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.inkFaint,
    backgroundColor: colors.canvas,
  },
  dropIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.xs,
  },
  dropTitle: { fontSize: 16, fontWeight: "700", color: colors.ink },
  dropSub: { ...type.caption, color: colors.inkMuted },
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
    gap: 6,
    padding: space.sm,
    backgroundColor: colors.canvas,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.inkFaint,
  },
  addPressed: { backgroundColor: colors.border },
  addIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  addLabel: { fontSize: 14, fontWeight: "600", color: colors.ink, textAlign: "center" },
  addSub: { ...type.caption, color: colors.inkMuted },
});
