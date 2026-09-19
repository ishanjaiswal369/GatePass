import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ApiError, authApi } from "@/api";
import {
  Button,
  Card,
  CodeInput,
  DevCodeNotice,
  ErrorNotice,
  MailIcon,
  PhoneFrame,
  RestoringScreen,
  ScreenHeader,
  TrashIcon,
} from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSession } from "@/providers/SessionProvider";
import { colors, space, type } from "@/theme";

/**
 * Deleting the account, in two steps: an emailed code, then the confirmation.
 *
 * The code is the safeguard -- a phone left unlocked, or a stolen session,
 * is not enough to delete someone's account. Anything that would block the
 * deletion (an upcoming booking, a payout still owed) is shown before a code
 * is ever sent, so nobody fetches a code only to be refused.
 */
export default function DeleteAccountScreen() {
  const { token, user, signOut, isRestoring } = useSession();

  const [blockers, setBlockers] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | undefined>();
  const [code, setCode] = useState("");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    authApi
      .getDeletionStatus(token)
      .then((status) => {
        if (!cancelled) setBlockers(status.blockers);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(
            err instanceof ApiError ? err.message : "Could not check your account"
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const { run: sendCode, busy: sending, error: sendError } = useAsyncAction(
    async () => {
      if (!token) return;
      const result = await authApi.requestDeletionCode(token);
      setDevCode(result.code);
      setCode("");
      setSent(true);
    }
  );

  const { run: confirm, busy: deleting, error: deleteError } = useAsyncAction(
    async () => {
      if (!token) return;
      await authApi.deleteAccount(token, code);
      // The API has already revoked every session, this one included, so the
      // stored token is dead -- clear it and start over at sign-in.
      signOut();
      router.replace("/");
    }
  );

  if (isRestoring) {
    return <RestoringScreen />;
  }

  if (!token) {
    return <Redirect href="/" />;
  }

  const blocked = blockers !== null && blockers.length > 0;

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader
          title="Delete account"
          sub={user?.email}
          onBack={() => router.back()}
        />

        <ScrollView contentContainerStyle={s.body}>
          <Card heading="What happens">
            <Text style={s.point}>You're signed out on every device.</Text>
            <Text style={s.point}>
              You can't sign in with this email again — not with a code, a
              password or Google.
            </Text>
            <Text style={s.point}>
              If you host a spot, it's taken out of search.
            </Text>
            <Text style={[s.point, s.pointLast]}>
              Past bookings and payments are kept for our records.
            </Text>
          </Card>

          {loadError ? <ErrorNotice message={loadError} /> : null}

          {blockers === null && !loadError ? (
            <ActivityIndicator color={colors.ink} style={s.loading} />
          ) : null}

          {blocked ? (
            <View style={s.blockers}>
              <Text style={s.blockersTitle}>Before you can delete</Text>
              {blockers.map((reason) => (
                <ErrorNotice key={reason} message={reason} />
              ))}
            </View>
          ) : null}

          {blockers !== null && !blocked ? (
            sent ? (
              <>
                <Text style={s.label}>
                  Enter the 6-digit code we sent to {user?.email}.
                </Text>

                {devCode ? <DevCodeNotice code={devCode} /> : null}

                <CodeInput value={code} onChange={setCode} autoFocus />

                {deleteError ? <ErrorNotice message={deleteError} /> : null}

                <View style={s.spacer} />

                <Button
                  label="Delete my account"
                  size="lg"
                  variant="danger"
                  leadingIcon={<TrashIcon color={colors.danger} />}
                  onPress={confirm}
                  busy={deleting}
                  disabled={code.length !== 6}
                />

                <Pressable
                  onPress={sendCode}
                  accessibilityRole="button"
                  style={s.resend}
                >
                  <Text style={s.resendLabel}>Send another code</Text>
                </Pressable>
              </>
            ) : (
              <>
                {sendError ? <ErrorNotice message={sendError} /> : null}

                <View style={s.spacer} />

                <Button
                  label="Email me a code"
                  size="lg"
                  variant="danger"
                  leadingIcon={<MailIcon color={colors.danger} />}
                  onPress={sendCode}
                  busy={sending}
                />
              </>
            )
          ) : null}
        </ScrollView>
      </View>
    </PhoneFrame>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  body: {
    paddingHorizontal: 20,
    paddingTop: space.lg,
    paddingBottom: 20,
    gap: space.lg,
    flexGrow: 1,
  },
  point: {
    ...type.body,
    color: colors.ink,
    lineHeight: 21,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pointLast: { borderBottomWidth: 0, color: colors.inkMuted },
  loading: { paddingVertical: space.xl },
  blockers: { gap: space.sm },
  blockersTitle: { ...type.label, color: colors.ink },
  label: { ...type.body, color: colors.inkMuted, lineHeight: 21 },
  spacer: { flexGrow: 1, minHeight: space.lg },
  resend: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  resendLabel: { fontSize: 14, fontWeight: "600", color: colors.inkMuted },
});
