import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { authApi } from "@/api";
import {
  ArrowRightIcon,
  Button,
  CheckIcon,
  ErrorNotice,
  Field,
  PhoneFrame,
  UserIcon,
} from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space, type } from "@/theme";

/**
 * Only reached when verify-code returned profileComplete false -- a new email
 * arrived through the sign-in screen, so no name was captured at signup.
 */
export default function ProfileScreen() {
  const { token, setUser } = useSession();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const { run, busy, error } = useAsyncAction(async () => {
    if (!token) {
      router.replace("/");
      return;
    }

    const user = await authApi.updateProfile(token, {
      firstName: firstName.trim(),
      ...(lastName.trim() ? { lastName: lastName.trim() } : {}),
    });

    setUser(user);
    router.replace("/account");
  });

  return (
    <PhoneFrame>
      <ScrollView contentContainerStyle={s.body}>
        <View style={s.badge}>
          <CheckIcon />
        </View>

        <View style={s.heading}>
          <Text style={s.title}>Email verified</Text>
          <Text style={s.sub}>
            One last thing — what should we call you? Organizers see this on
            your pass at the gate.
          </Text>
        </View>

        <Field
          label="First name"
          value={firstName}
          onChangeText={setFirstName}
          placeholder="Priya"
          autoCapitalize="words"
        />

        <Field
          label="Last name"
          optional
          value={lastName}
          onChangeText={setLastName}
          placeholder="Leave blank if you go by one name"
          autoCapitalize="words"
        />

        {error ? <ErrorNotice message={error} /> : null}

        <Button
          label="Continue"
          size="lg"
          onPress={run}
          busy={busy}
          disabled={firstName.trim().length === 0}
          icon={<ArrowRightIcon />}
        />

        <View style={s.spacer} />

        <View style={s.footnote}>
          <UserIcon />
          <Text style={s.footnoteText}>
            This screen only appears when we don't already have your name —
            signing up normally skips it.
          </Text>
        </View>
      </ScrollView>
    </PhoneFrame>
  );
}

const s = StyleSheet.create({
  body: { padding: 28, paddingTop: 72, gap: 18, flexGrow: 1 },
  badge: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.success,
    alignItems: "center",
    justifyContent: "center",
  },
  heading: { gap: space.sm },
  title: {
    fontSize: 27,
    fontWeight: "700",
    color: colors.ink,
    letterSpacing: -0.5,
  },
  sub: { fontSize: 14, color: colors.inkMuted, lineHeight: 22 },
  spacer: { flexGrow: 1, minHeight: space.lg },
  footnote: {
    flexDirection: "row",
    gap: 11,
    alignItems: "flex-start",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
  },
  footnoteText: {
    ...type.caption,
    color: colors.inkMuted,
    lineHeight: 19,
    flexShrink: 1,
  },
});
