import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { Button, DevCode, ErrorNote, Field, Screen } from "../components/ui";
import { ApiError, verifyCode } from "../lib/api";
import { useSession } from "../lib/session";
import { colors, type } from "../lib/theme";

export default function VerifyScreen() {
  const params = useLocalSearchParams<{ email: string; devCode?: string }>();
  const email = params.email ?? "";
  const { signIn } = useSession();

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);

    try {
      const result = await verifyCode({ email, code: code.trim() });
      signIn(result.token, result.user);

      // The API tells us whether a name was captured at signup. Without one
      // (arriving via the sign-in screen with a new email) we ask for it.
      router.replace(result.profileComplete ? "/account" : "/profile");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Enter code" subtitle={`Sent to ${email}`}>
      {params.devCode ? <DevCode code={params.devCode} /> : null}

      <Field
        label="6-digit code"
        value={code}
        onChangeText={(next) => setCode(next.replace(/\D/g, "").slice(0, 6))}
        placeholder="000000"
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={6}
      />

      {error ? <ErrorNote message={error} /> : null}

      <Button
        label="Verify"
        onPress={submit}
        busy={busy}
        disabled={code.length !== 6}
      />

      <Button
        label="Use a different email"
        variant="ghost"
        onPress={() => router.replace("/")}
      />

      <Text style={s.note}>
        The code expires in 5 minutes. After 5 wrong tries you need a new one.
      </Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  note: { ...type.caption, color: colors.inkFaint, textAlign: "center" },
});
