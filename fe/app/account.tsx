import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, authApi } from "@/api";
import {
  Button,
  Card,
  DataRow,
  ErrorNotice,
  PhoneFrame,
} from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSession } from "@/providers/SessionProvider";
import type { MeResult, SessionRow } from "@/types/api.types";
import { colors, space, type } from "@/theme";

export default function AccountScreen() {
  const { token, signOut } = useSession();
  const [me, setMe] = useState<MeResult | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    // Signed out: the <Redirect> below sends them to sign-in. Navigating
    // imperatively from here crashes on a cold load of /account -- a child's
    // effect runs before the root layout has mounted its navigator, and
    // expo-router throws "Attempted to navigate before mounting the Root
    // Layout component". A redirect element is rendered, so it cannot run
    // early.
    if (!token) {
      return;
    }

    // Re-reads from the API rather than trusting what verify-code returned,
    // so this screen also exercises the authenticated routes.
    Promise.all([authApi.getMe(token), authApi.listSessions(token)])
      .then(([user, result]) => {
        setMe(user);
        setSessions(result.sessions);
      })
      .catch((err) =>
        setLoadError(
          err instanceof ApiError ? err.message : "Could not load account"
        )
      );
  }, [token]);

  const { run: endSession, busy } = useAsyncAction(async () => {
    if (token) {
      // Signing out locally matters more than the call succeeding.
      await authApi.logout(token).catch(() => undefined);
    }
    // No navigation here: clearing the token re-renders this screen into the
    // redirect below, so sign-out takes the same path as a cold load.
    signOut();
  });

  const fullName = [me?.firstName, me?.lastName].filter(Boolean).join(" ");

  // After every hook, so the hook order never changes between renders.
  if (!token) {
    return <Redirect href="/" />;
  }

  return (
    <PhoneFrame>
      <ScrollView contentContainerStyle={s.body}>
        <View style={s.heading}>
          <Text style={s.title}>{fullName || "Signed in"}</Text>
          <Text style={s.sub}>{me?.email}</Text>
        </View>

        {loadError ? <ErrorNotice message={loadError} /> : null}

        <Card heading="Account">
          <DataRow label="First name" value={me?.firstName} />
          <DataRow label="Last name" value={me?.lastName} />
          <DataRow label="Role" value={me?.role} />
          <DataRow
            label="Profile complete"
            value={me ? (me.profileComplete ? "yes" : "no") : undefined}
          />
        </Card>

        <Card heading={`Devices (${sessions.length})`}>
          {sessions.map((session) => (
            <View key={session.id} style={s.session}>
              <Text style={s.sessionName}>
                {session.deviceName ?? session.deviceType}
                {session.current ? "  · this device" : ""}
              </Text>
              <Text style={s.sessionMeta}>
                {session.deviceId} ·{" "}
                {new Date(session.lastActiveAt).toLocaleTimeString()}
              </Text>
            </View>
          ))}
        </Card>

        <View style={s.spacer} />

        <Button label="Log out" size="lg" onPress={endSession} busy={busy} />
      </ScrollView>
    </PhoneFrame>
  );
}

const s = StyleSheet.create({
  body: { padding: 28, paddingTop: 56, gap: 18, flexGrow: 1 },
  heading: { gap: space.xs },
  title: {
    fontSize: 27,
    fontWeight: "700",
    color: colors.ink,
    letterSpacing: -0.5,
  },
  sub: { ...type.body, color: colors.inkMuted },
  session: {
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 2,
  },
  sessionName: { ...type.body, color: colors.ink, fontWeight: "600" },
  sessionMeta: { ...type.caption, color: colors.inkFaint },
  spacer: { flexGrow: 1, minHeight: space.lg },
});
