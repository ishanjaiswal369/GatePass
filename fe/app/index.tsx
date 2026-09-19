import { Redirect, router } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { authApi } from "@/api";
import {
  ArrowRightIcon,
  BrandHeader,
  Button,
  ErrorNotice,
  Field,
  LockIcon,
  MailIcon,
  PhoneFrame,
  RestoringScreen,
  SegmentedControl,
} from "@/components/ui";
import {
  GoogleSignIn,
  GoogleSignInUnconfigured,
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
  // Password sign-in is opt-in on the sign-in tab rather than a third
  // segment: codes stay the default path, and most accounts have no password.
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");

  const { signIn, token, isRestoring } = useSession();
  const isSignup = mode === "signup";

  // Google lands in the same place as a verified code: same session, same
  // response shape, same profileComplete routing.
  const onGoogleSuccess = useCallback(
    (result: VerifyCodeResult) => {
      signIn(result.token, result.user);
      router.replace(result.profileComplete ? "/home" : "/profile");
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

  const { run: signInWithPassword, busy: signingIn, error: passwordError } =
    useAsyncAction(async () => {
      const result = await authApi.loginWithPassword({
        email: email.trim(),
        password,
      });

      signIn(result.token, result.user);
      router.replace(result.profileComplete ? "/home" : "/profile");
    });

  const canSubmit =
    email.trim().length > 0 && (!isSignup || firstName.trim().length > 0);

  const passwordMode = !isSignup && usePassword;

  // After every hook, so hook order never changes between renders.
  if (isRestoring) {
    return <RestoringScreen />;
  }

  // Reloading with a stored session should land on the app, not on a sign-in
  // form the user has already been through.
  if (token) {
    return <Redirect href="/home" />;
  }

  return (
    <PhoneFrame>
      <BrandHeader
        headline={isSignup ? "Reserve parking\nbefore you arrive" : "Welcome back"}
        sub={
          isSignup
            ? "Concerts, matches and fairs across India."
            : usePassword
              ? "Enter your email and password."
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

        {passwordMode ? (
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••••"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            icon={<LockIcon />}
          />
        ) : null}

        {error || passwordError ? (
          <ErrorNotice message={error ?? passwordError ?? ""} />
        ) : null}

        {passwordMode ? (
          <Button
            label="Sign in"
            size="lg"
            onPress={signInWithPassword}
            busy={signingIn}
            disabled={!canSubmit || password.length === 0}
            icon={<ArrowRightIcon />}
          />
        ) : (
          <Button
            label="Send code"
            size="lg"
            onPress={run}
            busy={busy}
            disabled={!canSubmit}
            icon={<ArrowRightIcon />}
          />
        )}

        {!isSignup ? (
          <View style={s.altRow}>
            <Pressable
              onPress={() => {
                setUsePassword((on) => !on);
                setPassword("");
                clearError();
              }}
              accessibilityRole="button"
              style={s.altHit}
            >
              <Text style={s.altLabel}>
                {usePassword ? "Use an email code" : "Use a password"}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => router.push("/password")}
              accessibilityRole="button"
              style={s.altHit}
            >
              <Text style={s.altLabel}>Forgot password?</Text>
            </Pressable>
          </View>
        ) : null}

        {isGoogleConfigured ? (
          <GoogleSignIn onSuccess={onGoogleSuccess} disabled={busy} />
        ) : __DEV__ ? (
          <GoogleSignInUnconfigured />
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
  altRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  altHit: { minHeight: 44, justifyContent: "center" },
  altLabel: { fontSize: 13, fontWeight: "600", color: colors.inkMuted },
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
