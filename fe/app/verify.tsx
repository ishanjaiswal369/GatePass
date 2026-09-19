import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { authApi } from "@/api";
import {
  Button,
  ChevronLeftIcon,
  ClockIcon,
  CodeInput,
  DevCodeNotice,
  ErrorNotice,
  PhoneFrame,
} from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSession } from "@/providers/SessionProvider";
import { colors, radius, space, type } from "@/theme";

/** Matches RESEND_COOLDOWN_SECONDS in be/src/services/auth.service.ts. */
const RESEND_COOLDOWN_SECONDS = 60;

export default function VerifyScreen() {
  const { email = "", devCode } = useLocalSearchParams<{
    email: string;
    devCode?: string;
  }>();
  const { signIn } = useSession();

  const [code, setCode] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  const { run, busy, error } = useAsyncAction(async () => {
    const result = await authApi.verifyCode({ email, code: code.trim() });
    signIn(result.token, result.user);

    // The API says whether a name was captured at signup; without one we ask.
    router.replace(result.profileComplete ? "/home" : "/profile");
  });

  return (
    <PhoneFrame>
      <ScrollView contentContainerStyle={s.body}>
        <Pressable style={s.back} onPress={() => router.replace("/")}>
          <ChevronLeftIcon />
        </Pressable>

        <View style={s.heading}>
          <Text style={s.title}>Check your email</Text>
          <Text style={s.sub}>
            We sent a 6-digit code to{"\n"}
            <Text style={s.email}>{email}</Text>
          </Text>
        </View>

        <CodeInput value={code} onChange={setCode} autoFocus />

        {devCode ? <DevCodeNotice code={devCode} /> : null}

        <Button
          label="Verify"
          size="lg"
          onPress={run}
          busy={busy}
          disabled={code.length !== 6}
        />

        <View style={s.resend}>
          <ClockIcon />
          <Text style={s.resendText}>
            {secondsLeft > 0
              ? `Resend available in 0:${String(secondsLeft).padStart(2, "0")}`
              : "You can request a new code"}
          </Text>
        </View>

        <View style={s.spacer} />

        {error ? <ErrorNotice message={error} /> : null}

        <Text style={s.note}>
          Codes expire in 5 minutes. After 5 wrong tries you'll need a fresh one.
        </Text>

        <Button
          label="Use a different email"
          variant="ghost"
          onPress={() => router.replace("/")}
        />
      </ScrollView>
    </PhoneFrame>
  );
}

const s = StyleSheet.create({
  body: { padding: 28, paddingTop: 52, gap: 20, flexGrow: 1 },
  back: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
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
  email: { color: colors.ink, fontWeight: "600" },
  resend: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  resendText: { fontSize: 13, color: colors.inkFaint },
  spacer: { flexGrow: 1, minHeight: space.lg },
  note: {
    ...type.caption,
    color: colors.inkFaint,
    textAlign: "center",
    lineHeight: 19,
  },
});
