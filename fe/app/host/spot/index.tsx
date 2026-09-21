import { Redirect, router } from "expo-router";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  Button,
  Card,
  ErrorNotice,
  PhoneFrame,
  RestoringScreen,
  ScreenHeader,
} from "@/components/ui";
import { firstStepPath } from "@/constants/wizard";
import { useSpotDraft } from "@/hooks/useSpotDraft";
import { colors, space, type } from "@/theme";

/**
 * Where the listing stands once it has left the host's hands.
 *
 * This screen deliberately holds no introduction and no checklist. The Host
 * tab owns that, and having it here too meant a host met the same "Rent out
 * your space" page twice on the way in, with no way to tell the two apart.
 *
 * So anything still editable redirects straight into the wizard, and what is
 * left is the one thing the wizard cannot show: what happened after Submit.
 */
export default function SpotStatusScreen() {
  const { spot, loading, error, isRestoring, token } = useSpotDraft();

  if (isRestoring || loading) return <RestoringScreen />;
  if (!token) return <Redirect href="/" />;

  // No spot yet, or one the host can still change: there is nothing to report,
  // so go to the step that continues it. spot.id (when there is one) carries
  // forward so the wizard resumes this specific draft rather than whichever
  // one useSpotDraft's no-id fallback happens to find.
  if (!error && (!spot || spot.status === "DRAFT" || spot.status === "REJECTED")) {
    return <Redirect href={firstStepPath(spot?.id)} />;
  }

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader
          title="Your listing"
          sub={spot?.name}
          onBack={() => router.back()}
        />

        <ScrollView contentContainerStyle={s.body}>
          {error ? <ErrorNotice message={error} /> : null}

          {!spot ? (
            <ActivityIndicator color={colors.ink} style={s.loader} />
          ) : (
            <StatusCard
              status={spot.status}
              rejectionReason={spot.rejectionReason}
            />
          )}
        </ScrollView>
      </View>
    </PhoneFrame>
  );
}

function StatusCard({
  status,
  rejectionReason,
}: {
  status: string;
  rejectionReason: string | null;
}) {
  const copy =
    {
      PENDING_REVIEW: {
        title: "With us for review",
        body: "We are checking your ownership proof. Your spot goes live once that clears and your payout account is active — you will get an email either way.",
      },
      PUBLISHED: {
        title: "Your spot is live",
        body: "Drivers nearby can find and book it now.",
      },
      SUSPENDED: {
        title: "Your spot is paused",
        body: rejectionReason ?? "Contact support to put it back online.",
      },
    }[status] ?? { title: status, body: "" };

  return (
    <>
      <Card heading={copy.title}>
        <Text style={s.cardBody}>{copy.body}</Text>
      </Card>

      {status === "PUBLISHED" ? (
        <Button
          label="Back to your spot"
          variant="ghost"
          onPress={() => router.replace("/host")}
        />
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  body: { padding: 20, gap: space.lg },
  loader: { marginTop: space.xxl },
  cardBody: { fontSize: 14, lineHeight: 21, color: colors.inkMuted },
});
