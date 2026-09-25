import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, bookingsApi } from "@/api";
import {
  Button,
  CheckIcon,
  ErrorNotice,
  Field,
  PhoneFrame,
  RestoringScreen,
  ScreenHeader,
  Stars,
} from "@/components/ui";
import { STAR_WORDS, SUB_RATINGS } from "@/features/reviews/labels";
import { StarInput } from "@/features/reviews/StarInput";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { bookingListing, bookingWhen } from "@/lib/booking";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space } from "@/theme";
import type { BookingDetail, SubRatingKey } from "@/types/api.types";

/** Mirrors the API's limit, so the counter runs out where the server would refuse. */
const MAX_COMMENT = 500;

/**
 * Rating a spot after a stay.
 *
 * Only the overall stars are required; the three questions under them and
 * the comment are there for a driver who has something to say. Tapping a
 * question's chosen star again clears it, since "skip" is a real answer.
 *
 * A review can't be edited, so submitting swaps the form for the "Review
 * submitted" state in place, and a booking that was already reviewed opens
 * straight into it. A booking that can't be reviewed says why instead of
 * showing a form the server would refuse.
 */
export default function ReviewBookingScreen() {
  const { token, isRestoring } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [subs, setSubs] = useState<Partial<Record<SubRatingKey, number>>>({});
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState<number | null>(null);

  useEffect(() => {
    if (!token || !id) return;
    bookingsApi
      .get(token, id)
      .then((found) => {
        setBooking(found);
        if (found.review) setSubmitted(found.review.rating);
      })
      .catch((err) =>
        setLoadError(
          err instanceof ApiError && err.status === 404 ? "This booking doesn't exist, or isn't yours." : "Could not load this booking."
        )
      );
  }, [token, id]);

  const { run: submit, busy, error } = useAsyncAction(async () => {
    if (!token || !id || rating === null) return;
    const trimmed = comment.trim();
    const saved = await bookingsApi.review(token, id, {
      rating,
      ...subs,
      ...(trimmed ? { comment: trimmed } : {}),
    });
    setSubmitted(saved.rating);
  });

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  const back = () =>
    router.canGoBack() ? router.back() : id ? router.replace({ pathname: "/booking/[id]", params: { id } }) : router.replace("/bookings");
  // Back to the Past tab or the booking, whichever this was opened from --
  // both refetch on focus, so they show the review straight away.
  const done = () =>
    router.canGoBack() ? router.back() : router.replace({ pathname: "/bookings", params: { tab: "past" } });
  const listing = booking ? bookingListing(booking) : null;

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader title={submitted !== null ? "Your review" : "Rate parking"} onBack={back} />

        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          {loadError ? <ErrorNotice message={loadError} /> : null}

          {!booking ? (
            loadError ? null : <ActivityIndicator color={colors.ink} style={s.loading} />
          ) : submitted !== null ? (
            <View style={s.done}>
              <View style={s.doneBadge}>
                <CheckIcon size={28} color={colors.onInk} />
              </View>
              <Text style={s.doneTitle}>Review submitted</Text>
              <Stars value={submitted} size={22} />
              <Text style={s.doneBody}>
                Thanks for rating {listing?.name ?? "this parking"}. It helps the next driver choose, and it's shown on
                the spot with your first name.
              </Text>
              <View style={s.doneActions}>
                <Button label="Done" onPress={done} />
                {listing ? (
                  <Button
                    label="View parking"
                    variant="ghost"
                    onPress={() => router.push({ pathname: "/spots/[id]", params: { id: listing.id } })}
                  />
                ) : null}
              </View>
            </View>
          ) : !booking.canReview ? (
            <View style={s.blocked}>
              <Text style={s.blockedTitle}>This booking can't be reviewed</Text>
              <Text style={s.blockedBody}>{whyNot(booking)}</Text>
              <Button label="Back to booking" onPress={back} />
            </View>
          ) : (
            <>
              <View style={s.gap6}>
                <Text style={s.title}>How was your parking?</Text>
                <Text style={s.muted}>
                  {listing?.name} · {bookingWhen(booking)}
                </Text>
              </View>

              <View style={s.overall}>
                <StarInput value={rating} onChange={setRating} label="Overall" size={40} />
                <Text style={[s.word, rating === null && s.wordEmpty]}>
                  {rating === null ? "Tap to rate" : STAR_WORDS[rating]}
                </Text>
              </View>

              <View style={s.questions}>
                <Text style={s.label}>TELL US MORE (OPTIONAL)</Text>
                {SUB_RATINGS.map(({ key, question, label }) => (
                  <View key={key} style={s.question}>
                    <Text style={s.questionText}>{question}</Text>
                    <StarInput
                      value={subs[key] ?? null}
                      size={24}
                      label={label}
                      onChange={(value) =>
                        setSubs((current) => {
                          const next = { ...current };
                          if (next[key] === value) delete next[key];
                          else next[key] = value;
                          return next;
                        })
                      }
                    />
                  </View>
                ))}
              </View>

              <View style={s.gap6}>
                <Field
                  label="Comment"
                  optional
                  multiline
                  value={comment}
                  onChangeText={setComment}
                  maxLength={MAX_COMMENT}
                  placeholder="What should the next driver know?"
                  style={s.comment}
                />
                <Text style={s.counter}>
                  {comment.length}/{MAX_COMMENT}
                </Text>
              </View>

              {error ? <ErrorNotice message={error} /> : null}

              <Button
                label="Submit Review"
                size="lg"
                onPress={submit}
                busy={busy}
                disabled={rating === null}
              />
              <Text style={s.fine}>Reviews can't be edited once submitted. Hosts can't reply to them.</Text>
            </>
          )}
        </ScrollView>
      </View>
    </PhoneFrame>
  );
}

/** The server's rule, said in the driver's terms. */
function whyNot(booking: BookingDetail): string {
  if (booking.phase === "CANCELLED") return "Cancelled bookings can't be rated.";
  if (booking.phase !== "COMPLETED") return "You can rate this parking once your stay has ended.";
  if (booking.payment?.status !== "CAPTURED") return "Only a stay that was paid for can be rated.";
  return "This booking can't be rated.";
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  body: { padding: 20, gap: space.xl, paddingBottom: 32 },
  loading: { paddingVertical: space.xxl },
  gap6: { gap: 6 },
  title: { fontSize: 23, fontWeight: "700", color: colors.ink },
  muted: { fontSize: 14, lineHeight: 20, color: colors.inkMuted },
  overall: { alignItems: "center", gap: space.sm },
  word: { fontSize: 15, fontWeight: "700", color: colors.ink },
  wordEmpty: { color: colors.inkFaint, fontWeight: "600" },
  label: { fontSize: 12, fontWeight: "700", letterSpacing: 1.2, color: colors.inkMuted },
  questions: { gap: space.sm },
  question: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 2,
  },
  questionText: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.ink },
  comment: { minHeight: 96 },
  counter: { fontSize: 12, color: colors.inkMuted, textAlign: "right" },
  fine: { fontSize: 12, lineHeight: 18, color: colors.inkMuted, textAlign: "center" },
  done: { alignItems: "center", gap: space.md, paddingTop: space.xl },
  doneBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#166534",
    alignItems: "center",
    justifyContent: "center",
  },
  doneTitle: { fontSize: 22, fontWeight: "700", color: colors.ink },
  doneBody: { fontSize: 14, lineHeight: 21, color: colors.inkMuted, textAlign: "center" },
  doneActions: { alignSelf: "stretch", gap: space.sm, marginTop: space.md },
  blocked: { backgroundColor: colors.canvas, borderRadius: radius.md, padding: space.lg, gap: space.md },
  blockedTitle: { fontSize: 17, fontWeight: "700", color: colors.ink },
  blockedBody: { fontSize: 14, lineHeight: 21, color: colors.inkMuted },
});
