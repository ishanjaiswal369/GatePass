import { Redirect, router } from "expo-router";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  Button,
  Card,
  DataRow,
  ErrorNotice,
  PhoneFrame,
  RestoringScreen,
  ScreenHeader,
} from "@/components/ui";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { colors, radius, space, type } from "@/theme";

/**
 * The entry point to "Rent out your space".
 *
 * Three different screens in one, by status: an invitation before anything
 * exists, a resume card mid-draft, and a state card once it is submitted.
 * Splitting them into separate routes would mean deciding which to send a
 * host to before knowing what they have.
 */
export default function SpotHomeScreen() {
  const { spot, loading, error, isRestoring, token } = useSpotDraft();

  if (isRestoring) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader
          title="Rent out your space"
          sub="Earn from a driveway, garage or parking bay you already have."
          onBack={() => router.back()}
        />

        <ScrollView contentContainerStyle={s.body}>
          {error ? <ErrorNotice message={error} /> : null}

          {loading ? (
            <ActivityIndicator color={colors.ink} style={s.loader} />
          ) : !spot || spot.status === "DRAFT" ? (
            <StartOrResume hasDraft={Boolean(spot)} />
          ) : (
            <SubmittedState
              status={spot.status}
              rejectionReason={spot.rejectionReason}
            />
          )}
        </ScrollView>
      </View>
    </PhoneFrame>
  );
}

function StartOrResume({ hasDraft }: { hasDraft: boolean }) {
  return (
    <>
      <Card heading="What you will need">
        <View style={s.list}>
          <Bullet text="Photos of the space" />
          <Bullet text="The address, and a pin you can drag to the exact spot" />
          <Bullet text="Proof you may rent it out — an electricity bill or property tax receipt" />
          <Bullet text="Your PAN and bank details, so you can be paid" />
        </View>
      </Card>

      <Text style={s.note}>
        A listing goes live after we check your ownership proof and your payout
        account is active. Both usually finish within a couple of days.
      </Text>

      <Button
        label={hasDraft ? "Continue where you left off" : "Get started"}
        size="lg"
        onPress={() => router.push("/host/spot/type")}
      />
    </>
  );
}

function SubmittedState({
  status,
  rejectionReason,
}: {
  status: string;
  rejectionReason: string | null;
}) {
  const copy = {
    PENDING_REVIEW: {
      title: "With us for review",
      body: "We are checking your ownership proof. You will get an email when it is done.",
    },
    PUBLISHED: {
      title: "Your spot is live",
      body: "Drivers nearby can find and book it now.",
    },
    REJECTED: {
      title: "We could not approve this",
      body: rejectionReason ?? "Something was missing. Edit your spot and submit again.",
    },
    SUSPENDED: {
      title: "Your spot is paused",
      body: rejectionReason ?? "Contact support to put it back online.",
    },
  }[status] ?? { title: status, body: "" };

  return (
    <>
      <Card heading={copy.title}>
        <Text style={s.stateBody}>{copy.body}</Text>
      </Card>

      {status === "REJECTED" ? (
        <Button
          label="Edit and resubmit"
          size="lg"
          onPress={() => router.push("/host/spot/type")}
        />
      ) : null}
    </>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={s.bullet}>
      <View style={s.dot} />
      <Text style={s.bulletText}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  body: { padding: 20, gap: space.lg },
  loader: { marginTop: space.xxl },
  stateBody: { fontSize: 14, lineHeight: 20, color: colors.inkMuted },
  list: { gap: space.md },
  bullet: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.accent,
    marginTop: 7,
  },
  bulletText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.inkMuted },
  note: { ...type.caption, color: colors.inkFaint, lineHeight: 18 },
});
