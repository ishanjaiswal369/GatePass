import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { authApi } from "@/api";
import { Button, ErrorNotice, Field, LockIcon } from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSession } from "@/providers/SessionProvider";
import { colors, space, type } from "@/theme";

/** Matches passwordSchema in be/src/requests/auth.request.ts. */
const MIN_PASSWORD_LENGTH = 10;

/**
 * Change a known password by proving the current one.
 *
 * The checks here are for the person typing -- the API enforces length,
 * difference from the current password, and the attempt limit regardless.
 */
export function ChangePasswordForm({
  onChanged,
  onForgot,
}: {
  /** Called with how many other devices were signed out. */
  onChanged: (signedOutSessions: number) => void;
  /** Switches to the emailed-code flow for someone who lost the current one. */
  onForgot: () => void;
}) {
  const { token, setUser } = useSession();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const { run, busy, error } = useAsyncAction(async () => {
    if (!token) return;

    const result = await authApi.changePassword(token, {
      currentPassword: current,
      newPassword: next,
    });

    setUser(result.user);
    onChanged(result.signedOutSessions);
  });

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD_LENGTH;
  const sameAsCurrent = next.length > 0 && next === current;
  const mismatch = confirm.length > 0 && confirm !== next;

  const canSubmit =
    current.length > 0 &&
    next.length >= MIN_PASSWORD_LENGTH &&
    next === confirm &&
    !sameAsCurrent;

  return (
    <View style={s.form}>
      <Field
        label="Current password"
        value={current}
        onChangeText={setCurrent}
        placeholder="••••••••••"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        textContentType="password"
        icon={<LockIcon />}
      />

      <Pressable
        onPress={onForgot}
        accessibilityRole="button"
        style={s.forgot}
      >
        <Text style={s.forgotLabel}>Forgot it? Reset with an emailed code</Text>
      </Pressable>

      <Field
        label="New password"
        hint={
          tooShort
            ? `${MIN_PASSWORD_LENGTH - next.length} more character${MIN_PASSWORD_LENGTH - next.length === 1 ? "" : "s"} needed`
            : sameAsCurrent
              ? "That's your current password — choose a different one"
              : `At least ${MIN_PASSWORD_LENGTH} characters. A phrase you'll remember beats a short jumble.`
        }
        value={next}
        onChangeText={setNext}
        placeholder="••••••••••"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
      />

      <Field
        label="Confirm new password"
        hint={mismatch ? "Doesn't match the new password" : undefined}
        value={confirm}
        onChangeText={setConfirm}
        placeholder="••••••••••"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
      />

      {error ? <ErrorNotice message={error} /> : null}

      <Text style={s.note}>
        You'll stay signed in here. Every other device will be signed out.
      </Text>

      <View style={s.spacer} />

      <Button
        label="Change password"
        size="lg"
        onPress={run}
        busy={busy}
        disabled={!canSubmit}
      />
    </View>
  );
}

const s = StyleSheet.create({
  form: { gap: space.lg, flexGrow: 1 },
  forgot: {
    minHeight: 44,
    justifyContent: "center",
    alignSelf: "flex-start",
    marginTop: -space.sm,
  },
  forgotLabel: { ...type.label, color: colors.inkMuted },
  note: { ...type.caption, color: colors.inkFaint, lineHeight: 18 },
  spacer: { flexGrow: 1, minHeight: space.lg },
});
