import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button, ErrorNote, Field, Screen } from "../components/ui";
import { ApiError, requestCode } from "../lib/api";
import { colors, radius, space, type } from "../lib/theme";

type Mode = "signup" | "signin";

export default function EmailScreen() {
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignup = mode === "signup";
  const canSubmit =
    email.trim().length > 0 && (!isSignup || firstName.trim().length > 0);

  async function submit() {
    setBusy(true);
    setError(null);

    try {
      // Only the signup screen sends a name. The API treats it as pending
      // until the code is confirmed, and ignores it if the account exists.
      const result = await requestCode({
        email: email.trim(),
        ...(isSignup && firstName.trim() ? { firstName: firstName.trim() } : {}),
        ...(isSignup && lastName.trim() ? { lastName: lastName.trim() } : {}),
      });

      router.push({
        pathname: "/verify",
        params: { email: email.trim(), devCode: result.code ?? "" },
      });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Something went wrong"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="GatePass"
      subtitle="Parking for ticketed events"
    >
      <View style={s.tabs}>
        {(["signup", "signin"] as const).map((m) => (
          <Pressable
            key={m}
            onPress={() => {
              setMode(m);
              setError(null);
            }}
            style={[s.tab, mode === m && s.tabActive]}
          >
            <Text style={[s.tabLabel, mode === m && s.tabLabelActive]}>
              {m === "signup" ? "Sign up" : "Sign in"}
            </Text>
          </Pressable>
        ))}
      </View>

      {isSignup ? (
        <>
          <Field
            label="First name"
            value={firstName}
            onChangeText={setFirstName}
            placeholder="Ishan"
            autoCapitalize="words"
          />
          <Field
            label="Last name"
            value={lastName}
            onChangeText={setLastName}
            placeholder="Jaiswal"
            autoCapitalize="words"
            hint="Optional"
          />
        </>
      ) : null}

      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        inputMode="email"
      />

      {error ? <ErrorNote message={error} /> : null}

      <Button
        label="Send code"
        onPress={submit}
        busy={busy}
        disabled={!canSubmit}
      />

      <Text style={s.note}>
        We email you a 6-digit code. No password needed.
      </Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  tabs: {
    flexDirection: "row",
    gap: space.xs,
    backgroundColor: colors.canvas,
    borderRadius: radius.sm,
    padding: space.xs,
  },
  tab: {
    flexGrow: 1,
    alignItems: "center",
    paddingVertical: space.md,
    borderRadius: radius.sm - 2,
    minHeight: 44,
    justifyContent: "center",
  },
  tabActive: { backgroundColor: colors.surface },
  tabLabel: { ...type.label, color: colors.inkMuted },
  tabLabelActive: { color: colors.ink },
  note: { ...type.caption, color: colors.inkFaint, textAlign: "center" },
});
