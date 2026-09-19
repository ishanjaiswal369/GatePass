import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { authApi } from "@/api";
import {
  Button,
  DevCodeNotice,
  ErrorNotice,
  Field,
  MailIcon,
  PhoneFrame,
  ScreenHeader,
  RestoringScreen,
} from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSession } from "@/providers/SessionProvider";
import { colors, space } from "@/theme";

const MIN_PASSWORD_LENGTH = 10;

/**
 * Setting a password, from either direction.
 *
 * Signed in it is "set or change your password" from the profile; signed out
 * it is "forgot password" from the sign-in screen. Both prove the email the
 * same way, so they are one screen rather than two near-identical ones -- the
 * only difference is whether the address is already known.
 */
export default function PasswordScreen() {
  const { token, user, signIn, isRestoring } = useSession();

  const signedIn = Boolean(token);

  const [email, setEmail] = useState(user?.email ?? "");
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | undefined>();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");

  const { run: sendCode, busy: sending, error: sendError } = useAsyncAction(
    async () => {
      const result = await authApi.requestPasswordCode(email.trim());
      setDevCode(result.code);
      setSent(true);
    }
  );

  const { run: submit, busy: saving, error: saveError } = useAsyncAction(
    async () => {
      const result = await authApi.setPassword({
        email: email.trim(),
        code: code.trim(),
        password,
      });

      // The API revokes every earlier session and returns a fresh one, so the
      // app has to adopt that token -- the old one stopped working the moment
      // the password was set.
      signIn(result.token, result.user);
      router.replace(result.profileComplete ? "/home" : "/profile");
    }
  );

  if (isRestoring) {
    return <RestoringScreen />;
  }

  const canSend = email.trim().length > 3;
  const canSubmit = code.trim().length === 6 && password.length >= MIN_PASSWORD_LENGTH;

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader
          title={
            signedIn
              ? user?.hasPassword
                ? "Change password"
                : "Set a password"
              : "Reset password"
          }
          sub={
            sent
              ? `Enter the 6-digit code we sent to ${email.trim()}.`
              : "We'll email you a code to confirm it's you."
          }
          onBack={() => router.back()}
        />

        <ScrollView contentContainerStyle={s.body}>
        {/* Signed in, the address is already known and is not up for editing:
            changing it here would mail a code to someone else's inbox. */}
        {signedIn ? (
          <View style={s.emailRow}>
            <MailIcon />
            <Text style={s.emailValue}>{email}</Text>
          </View>
        ) : (
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
            editable={!sent}
          />
        )}

        {sent ? (
          <>
            {devCode ? <DevCodeNotice code={devCode} /> : null}

            <Field
              label="Code"
              value={code}
              onChangeText={(next) => setCode(next.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={6}
            />

            <Field
              label="New password"
              hint={`At least ${MIN_PASSWORD_LENGTH} characters. A phrase you'll remember beats a short jumble.`}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••••"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />

            {saveError ? <ErrorNotice message={saveError} /> : null}

            <Text style={s.note}>
              Setting a password signs you out everywhere else.
            </Text>

            <View style={s.spacer} />

            <Button
              label="Save password"
              size="lg"
              onPress={submit}
              busy={saving}
              disabled={!canSubmit}
            />

            <Pressable onPress={sendCode} accessibilityRole="button" style={s.resend}>
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
              onPress={sendCode}
              busy={sending}
              disabled={!canSend}
            />
          </>
        )}
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
  emailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: colors.canvas,
    borderRadius: 12,
  },
  emailValue: { fontSize: 15, fontWeight: "600", color: colors.ink },
  note: { fontSize: 12, color: colors.inkFaint, lineHeight: 18 },
  spacer: { flexGrow: 1, minHeight: space.lg },
  resend: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  resendLabel: { fontSize: 14, fontWeight: "600", color: colors.inkMuted },
});
