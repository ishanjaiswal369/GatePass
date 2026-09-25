import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, bookingsApi, problemsApi, spotListingApi } from "@/api";
import {
  Button,
  CameraIcon,
  ErrorNotice,
  Field,
  HostIcon,
  PhoneFrame,
  RestoringScreen,
  ScreenHeader,
} from "@/components/ui";
import { PROBLEM_CATEGORIES, type ProblemCategory } from "@/constants/enums";
import { PROBLEM_LABELS } from "@/features/bookings/problemLabels";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { bookingListing, bookingRef, bookingWhen } from "@/lib/booking";
import { useScreenInsets } from "@/hooks/useScreenInsets";
import { pickImages } from "@/lib/pickImages";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space } from "@/theme";
import type { BookingDetail } from "@/types/api.types";

/** Mirrors the API's limit. */
const MAX_DETAILS = 500;

/**
 * "What's wrong?" -- one of six, a few optional words, an optional photo.
 *
 * Continue files the report and replaces this screen with its status, so
 * Back from there returns to the parking rather than to a form already sent.
 * If the booking was reported already (another device, a double tap), the
 * API answers with that report and this screen opens it instead.
 */
export default function ReportProblemScreen() {
  const insets = useScreenInsets();
  const { token, isRestoring } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [category, setCategory] = useState<ProblemCategory | null>(null);
  const [details, setDetails] = useState("");
  const [photo, setPhoto] = useState<{ uri: string; url: string } | null>(null);

  useEffect(() => {
    if (!token || !id) return;
    bookingsApi
      .get(token, id)
      .then((found) => {
        if (found.problem) router.replace({ pathname: "/booking/[id]/problem", params: { id } });
        else setBooking(found);
      })
      .catch((err) =>
        setLoadError(err instanceof ApiError && err.status === 404 ? "This booking doesn't exist, or isn't yours." : "Could not load this booking.")
      );
  }, [token, id]);

  const { run: addPhoto, busy: uploading, error: photoError } = useAsyncAction(async () => {
    if (!token || !id) return;
    const picked = await pickImages({ quality: 0.7 });
    if (!picked) return;
    const [image] = picked;
    const presigned = await problemsApi.photoUploadUrl(token, id, {
      contentType: image.contentType,
      contentLength: image.size,
    });
    const url = await spotListingApi.uploadFile(presigned, image.blob);
    setPhoto({ uri: image.uri, url });
  });

  const { run: send, busy, error } = useAsyncAction(async () => {
    if (!token || !id || !category) return;
    const trimmed = details.trim();
    try {
      await problemsApi.report(token, id, {
        category,
        ...(trimmed ? { details: trimmed } : {}),
        ...(photo ? { photoUrl: photo.url } : {}),
      });
    } catch (err) {
      // Already reported: show that report rather than an error.
      if (!(err instanceof ApiError && err.status === 409 && /already reported/.test(err.message))) throw err;
    }
    router.replace({ pathname: "/booking/[id]/problem", params: { id } });
  });

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  const back = () => (router.canGoBack() ? router.back() : router.replace({ pathname: "/booking/[id]", params: { id: id ?? "" } }));
  const listing = booking ? bookingListing(booking) : null;

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader title="Report a problem" onBack={back} />

        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          {loadError ? <ErrorNotice message={loadError} /> : null}

          {!booking ? (
            loadError ? null : <ActivityIndicator color={colors.ink} style={s.loading} />
          ) : (
            <>
              <View style={s.summary}>
                <HostIcon size={18} />
                <Text style={s.summaryText} numberOfLines={2}>
                  <Text style={s.bold}>{listing?.name}</Text> · {bookingRef(booking.id)} · {bookingWhen(booking)}
                </Text>
              </View>

              <Text style={s.title}>What's wrong?</Text>

              <View style={s.options} accessibilityRole="radiogroup">
                {PROBLEM_CATEGORIES.map((key) => {
                  const on = category === key;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => setCategory(key)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      style={[s.option, on && s.optionOn]}
                    >
                      <View style={s.radio}>{on ? <View style={s.dot} /> : null}</View>
                      <Text style={s.optionText}>{PROBLEM_LABELS[key]}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={s.gap6}>
                <Field
                  label="Tell us more"
                  optional
                  multiline
                  value={details}
                  onChangeText={setDetails}
                  maxLength={MAX_DETAILS}
                  placeholder="e.g. The shutter is down and the guard isn't at the gate."
                  style={s.details}
                />
                <Text style={s.counter}>
                  {details.length}/{MAX_DETAILS}
                </Text>
              </View>

              {photo ? (
                <View style={s.photoRow}>
                  <Image source={{ uri: photo.uri }} style={s.thumb} accessibilityIgnoresInvertColors />
                  <Text style={s.photoText}>Photo added</Text>
                  <Button label="Remove" variant="ghost" onPress={() => setPhoto(null)} />
                </View>
              ) : (
                <Pressable
                  onPress={addPhoto}
                  disabled={uploading}
                  accessibilityRole="button"
                  style={({ pressed }) => [s.addPhoto, pressed && s.pressed]}
                >
                  {uploading ? <ActivityIndicator color={colors.ink} /> : <CameraIcon />}
                  <View style={s.gap2}>
                    <Text style={s.optionText}>Add a photo (optional)</Text>
                    <Text style={s.muted}>A photo of the gate or the space helps us resolve this faster</Text>
                  </View>
                </Pressable>
              )}
              {photoError ? <ErrorNotice message={photoError} /> : null}
              {error ? <ErrorNotice message={error} /> : null}
            </>
          )}
        </ScrollView>

        {booking ? (
          <View style={[s.bar, { paddingBottom: 18 + insets.bottom }]}>
            <Button
              label={category ? "Continue" : "Choose what's wrong"}
              size="lg"
              onPress={send}
              busy={busy}
              disabled={!category || uploading}
            />
          </View>
        ) : null}
      </View>
    </PhoneFrame>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  body: { padding: 20, gap: 14, paddingBottom: 24 },
  loading: { paddingVertical: space.xxl },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.canvas,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  summaryText: { flex: 1, fontSize: 13, color: "#374151" },
  bold: { fontWeight: "700", color: colors.ink },
  title: { fontSize: 21, fontWeight: "700", color: colors.ink },
  options: { gap: space.sm },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: 52,
    paddingVertical: space.sm,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionOn: { borderWidth: 2, borderColor: colors.ink },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.ink },
  optionText: { fontSize: 15, fontWeight: "600", color: colors.ink },
  gap6: { gap: 6 },
  gap2: { flex: 1, gap: 2 },
  details: { minHeight: 80 },
  counter: { fontSize: 12, color: colors.inkMuted, textAlign: "right" },
  addPhoto: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: 64,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#cbd0d8",
    borderRadius: 10,
  },
  pressed: { backgroundColor: colors.canvas },
  muted: { fontSize: 12, color: colors.inkMuted },
  photoRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  thumb: { width: 56, height: 56, borderRadius: radius.sm },
  photoText: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.ink },
  bar: { borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 18 },
});
