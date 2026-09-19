import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { authApi } from "@/api";
import {
  Button,
  ErrorNotice,
  Field,
  PhoneFrame,
  ScreenHeader,
  RestoringScreen,
} from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useSession } from "@/providers/SessionProvider";
import { colors, space } from "@/theme";

/** The API stores +91XXXXXXXXXX; the field edits the ten local digits. */
function toLocal(phone: string | null | undefined): string {
  return (phone ?? "").replace("+91", "");
}

export default function DetailsScreen() {
  const { token, user, setUser, isRestoring } = useSession();

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
      <View style={s.screen}>
        <ScreenHeader title="Personal details" sub={user?.email} onBack={() => router.back()} />

        <ScrollView contentContainerStyle={s.body}>
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
  prefix: { fontSize: 15, fontWeight: "600", color: colors.inkMuted },
  saved: { fontSize: 13, color: colors.inkMuted },
  spacer: { flexGrow: 1, minHeight: space.lg },
});
