import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { profileApi } from "@/api";
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
import { colors, radius, space } from "@/theme";

export default function AddressScreen() {
  const { token, isRestoring } = useSession();

  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!token) return;

    profileApi
      .getAddress(token)
      .then(({ address }) => {
        if (!address) return;
        setState(address.state);
        setCity(address.city);
        setAddressLine(address.addressLine);
      })
      .catch(() => undefined);
  }, [token]);

  const { run: save, busy, error } = useAsyncAction(async () => {
    if (!token) return;

    await profileApi.saveAddress(token, {
      state: state.trim(),
      city: city.trim(),
      addressLine: addressLine.trim(),
    });

    setSaved(true);
  });

  if (isRestoring) {
    return <RestoringScreen />;
  }

  if (!token) {
    return <Redirect href="/" />;
  }

  const canSave = Boolean(state.trim() && city.trim() && addressLine.trim());

  const touched = () => setSaved(false);

  return (
    <PhoneFrame>
      <View style={s.screen}>
        <ScreenHeader title="Address" sub={"Where you live, not where you park."} onBack={() => router.back()} />

        <ScrollView contentContainerStyle={s.body}>
        {/* Country is fixed rather than a one-option picker: the API refuses to
            take it from the client, so a control that cannot change anything
            would only invite the question. */}
        <View style={s.country}>
          <Text style={s.countryLabel}>Country</Text>
          <Text style={s.countryValue}>India</Text>
        </View>

        <Field
          label="State"
          value={state}
          onChangeText={(next) => {
            setState(next);
            touched();
          }}
          placeholder="Maharashtra"
          autoCapitalize="words"
        />

        <Field
          label="City"
          value={city}
          onChangeText={(next) => {
            setCity(next);
            touched();
          }}
          placeholder="Mumbai"
          autoCapitalize="words"
        />

        <Field
          label="Address"
          value={addressLine}
          onChangeText={(next) => {
            setAddressLine(next);
            touched();
          }}
          placeholder="12 Carter Road, Bandra West"
          autoCapitalize="words"
          multiline
        />

        {error ? <ErrorNotice message={error} /> : null}
        {saved && !error ? <Text style={s.saved}>Saved.</Text> : null}

        <View style={s.spacer} />

        <Button label="Save address" size="lg" onPress={save} busy={busy} disabled={!canSave} />
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
  country: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: colors.canvas,
    borderRadius: radius.md,
  },
  countryLabel: { fontSize: 13, fontWeight: "600", color: colors.inkMuted },
  countryValue: { fontSize: 15, fontWeight: "600", color: colors.ink },
  saved: { fontSize: 13, color: colors.inkMuted },
  spacer: { flexGrow: 1, minHeight: space.lg },
});
