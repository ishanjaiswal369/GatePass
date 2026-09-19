import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, authApi } from "@/api";
import {
  Button,
  ChevronLeftIcon,
  ErrorNotice,
  Field,
  PhoneFrame,
  RestoringScreen,
} from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useScreenInsets } from "@/hooks/useScreenInsets";
import { useSession } from "@/providers/SessionProvider";
import { colors, space } from "@/theme";
import { Pressable } from "react-native";

/** The API stores +91XXXXXXXXXX; the field edits the ten local digits. */
function toLocal(phone: string | null | undefined): string {
  return (phone ?? "").replace("+91", "");
}

export default function DetailsScreen() {
  const { token, user, setUser, isRestoring } = useSession();
  const insets = useScreenInsets();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!token) return;

    authApi
      .getMe(token)
      .then((me) => {
        setFirstName(me.firstName ?? "");
        setLastName(me.lastName ?? "");
        setPhone(toLocal(me.phone));
      })
      .catch(() => undefined);
  }, [token]);

  const { run: save, busy, error } = useAsyncAction(async () => {
    if (!token) return;

    const trimmedPhone = phone.trim();

    const me = await authApi.updateProfile(token, {
      firstName: firstName.trim(),
      // Sending null clears it; omitting it leaves it alone. An empty box
      // means the user cleared the surname on purpose.
      lastName: lastName.trim() || null,
      ...(trimmedPhone ? { phone: trimmedPhone } : {}),
    });

    setUser(me);
    setSaved(true);
  });

  if (isRestoring) {
    return <RestoringScreen />;
  }

  if (!token) {
    return <Redirect href="/" />;
  }

  return (
    <PhoneFrame>
      <ScrollView contentContainerStyle={[s.body, { paddingTop: insets.top + 20 }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={s.back}
        >
          <ChevronLeftIcon />
        </Pressable>

        <View style={s.heading}>
          <Text style={s.title}>Personal details</Text>
          <Text style={s.sub}>{user?.email}</Text>
        </View>

        <Field
          label="First name"
          value={firstName}
          onChangeText={(next) => {
            setFirstName(next);
            setSaved(false);
          }}
          placeholder="Ishan"
          autoCapitalize="words"
        />

        <Field
          label="Last name"
          optional
          value={lastName}
          onChangeText={(next) => {
            setLastName(next);
            setSaved(false);
          }}
          placeholder="Jaiswal"
          autoCapitalize="words"
        />

        <Field
          label="Mobile number"
          hint="Indian mobile numbers only. We use it for booking updates and at the gate."
          value={phone}
          onChangeText={(next) => {
            // Digits only: the +91 is fixed and shown as a prefix, so typing
            // it again would make the number eleven digits long.
            setPhone(next.replace(/\D/g, "").slice(0, 10));
            setSaved(false);
          }}
          placeholder="98765 43210"
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={10}
          icon={<Text style={s.prefix}>+91</Text>}
        />

        {error ? <ErrorNotice message={error} /> : null}
        {saved && !error ? <Text style={s.saved}>Saved.</Text> : null}

        <View style={s.spacer} />

        <Button
          label="Save"
          size="lg"
          onPress={save}
          busy={busy}
          disabled={!firstName.trim() || (phone.length > 0 && phone.length < 10)}
        />
      </ScrollView>
    </PhoneFrame>
  );
}

const s = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 20, gap: space.lg, flexGrow: 1 },
  back: { width: 44, height: 44, marginLeft: -12, justifyContent: "center" },
  heading: { gap: 4 },
  title: { fontSize: 27, fontWeight: "700", color: colors.ink, letterSpacing: -0.5 },
  sub: { fontSize: 15, color: colors.inkMuted },
  prefix: { fontSize: 15, fontWeight: "600", color: colors.inkMuted },
  saved: { fontSize: 13, color: colors.inkMuted },
  spacer: { flexGrow: 1, minHeight: space.lg },
});
