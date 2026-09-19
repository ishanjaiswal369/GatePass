import { ActivityIndicator, StyleSheet, View } from "react-native";
import { colors } from "@/theme";
import { PhoneFrame } from "./PhoneFrame";

/**
 * Shown for the moment between launch and knowing whether there is a stored
 * session. Without it, every protected screen reads `token === null` on its
 * first render and redirects to sign-in before the token has loaded -- so a
 * reload looks exactly like being signed out.
 */
export function RestoringScreen() {
  return (
    <PhoneFrame>
      <View style={s.wrap}>
        <ActivityIndicator color={colors.ink} />
      </View>
    </PhoneFrame>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center" },
});
