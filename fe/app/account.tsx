import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, ErrorNote, Row, Screen } from "../components/ui";
import {
  ApiError,
  getMe,
  listSessions,
  logout,
  type MeResult,
  type SessionRow,
} from "../lib/api";
import { useSession } from "../lib/session";
import { colors, radius, space, type } from "../lib/theme";

export default function AccountScreen() {
  const { token, signOut } = useSession();
  const [me, setMe] = useState<MeResult | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      router.replace("/");
      return;
    }

    // Re-reads from the API rather than trusting what verify-code returned,
    // so this screen also exercises the authenticated routes.
    Promise.all([getMe(token), listSessions(token)])
      .then(([user, result]) => {
        setMe(user);
        setSessions(result.sessions);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Could not load account")
      );
  }, [token]);

  async function endSession() {
    if (!token) return;
    setBusy(true);
    try {
      await logout(token);
    } catch {
      // Signing out locally matters more than the call succeeding.
    } finally {
      signOut();
      router.replace("/");
    }
  }

  return (
    <Screen title="Signed in" subtitle={me?.email}>
      {error ? <ErrorNote message={error} /> : null}

      <View style={s.block}>
        <Text style={s.blockTitle}>Account</Text>
        <Row label="First name" value={me?.firstName} />
        <Row label="Last name" value={me?.lastName} />
        <Row label="Role" value={me?.role} />
        <Row
          label="Profile complete"
          value={me ? (me.profileComplete ? "yes" : "no") : undefined}
        />
      </View>

      <View style={s.block}>
        <Text style={s.blockTitle}>Devices ({sessions.length})</Text>
        <ScrollView style={s.sessions}>
          {sessions.map((session) => (
            <View key={session.id} style={s.session}>
              <Text style={s.sessionName}>
                {session.deviceName ?? session.deviceType}
                {session.current ? "  · this device" : ""}
              </Text>
              <Text style={s.sessionMeta}>
                {session.deviceId} · {new Date(session.lastActiveAt).toLocaleTimeString()}
              </Text>
            </View>
          ))}
        </ScrollView>
      </View>

      <Button label="Log out" onPress={endSession} busy={busy} />
    </Screen>
  );
}

const s = StyleSheet.create({
  block: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.xs,
  },
  blockTitle: {
    ...type.label,
    color: colors.inkMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: space.xs,
  },
  sessions: { maxHeight: 140 },
  session: {
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 2,
  },
  sessionName: { ...type.body, color: colors.ink, fontWeight: "600" },
  sessionMeta: { ...type.caption, color: colors.inkFaint },
});
