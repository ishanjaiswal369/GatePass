import { router } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { authApi } from "@/api";
import {
  ArrowRightIcon,
  BrandHeader,
  Button,
  ErrorNotice,
  Field,
  MailIcon,
  PhoneFrame,
  SegmentedControl,
} from "@/components/ui";
import {
  GoogleSignIn,
  isGoogleConfigured,
} from "@/features/auth/GoogleSignIn";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSession } from "@/providers/SessionProvider";
import type { VerifyCodeResult } from "@/types/api.types";
import { colors, space, type } from "@/theme";

type Mode = "signup" | "signin";

const MODES = [
  { value: "signup" as const, label: "Sign up" },
  { value: "signin" as const, label: "Sign in" },
];

export default function EmailScreen() {
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const { signIn } = useSession();
  const isSignup = mode === "signup";

  // Google lands in the same place as a verified code: same session, same
  // response shape, same profileComplete routing.
  const onGoogleSuccess = useCallback(
    (result: VerifyCodeResult) => {
      signIn(result.token, result.user);
      router.replace(result.profileComplete ? "/account" : "/profile");
    },
    [signIn]
  );

  const { run, busy, error, clearError } = useAsyncAction(async () => {
    // Only signup sends a name. The API parks it on the verification row and
    // ignores it entirely when the account already exists.
    const result = await authApi.requestCode({
      email: email.trim(),
      ...(isSignup && firstName.trim() ? { firstName: firstName.trim() } : {}),
      ...(isSignup && lastName.trim() ? { lastName: lastName.trim() } : {}),
    });

    router.push({
      pathname: "/verify",
      params: { email: email.trim(), devCode: result.code ?? "" },
    });
  });

  const canSubmit =
    email.trim().length > 0 && (!isSignup || firstName.trim().length > 0);

  return (
    <PhoneFrame>
      <BrandHeader
        headline={isSignup ? "Reserve parking\nbefore you arrive" : "Welcome back"}
        sub={
          isSignup
            ? "Concerts, matches and fairs across India."
            : "Enter your email and we'll send a code."
        }
      />

      <ScrollView contentContainerStyle={s.body}>
        <SegmentedControl
          segments={MODES}
          value={mode}
          onChange={(next) => {
            setMode(next);
            clearError();
          }}
        />

        {isSignup ? (
          <View style={s.nameRow}>
            <View style={s.nameCell}>
              <Field
                label="First name"
                value={firstName}
                onChangeText={setFirstName}
                placeholder="Ishan"
                autoCapitalize="words"
              />
            </View>
            <View style={s.nameCell}>
              <Field
                label="Last name"
                optional
                value={lastName}
                onChangeText={setLastName}
                placeholder="Jaiswal"
                autoCapitalize="words"
              />
            </View>
          </View>
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
          icon={<MailIcon />}
        />

        {error ? <ErrorNotice message={error} /> : null}

        <Button
          label="Send code"
          size="lg"
          onPress={run}
          busy={busy}
          disabled={!canSubmit}
          icon={<ArrowRightIcon />}
        />

        {isGoogleConfigured ? (
          <GoogleSignIn onSuccess={onGoogleSuccess} disabled={busy} />
        ) : null}

        <View style={s.spacer} />

        <Text style={s.note}>
          {isSignup
            ? "No password to remember — we email you a 6-digit code each time."
            : "First time here? Signing in with a new email creates your account — we'll just ask your name after."}
        </Text>
      </ScrollView>
    </PhoneFrame>
  );
}

const s = StyleSheet.create({
  body: { padding: 28, gap: 18, flexGrow: 1 },
  nameRow: { flexDirection: "row", gap: space.md },
  nameCell: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  spacer: { flexGrow: 1, minHeight: space.lg },
  note: {
    ...type.caption,
    color: colors.inkFaint,
    textAlign: "center",
    lineHeight: 19,
  },
});
