import { Text, View } from "react-native";
import { ErrorNotice, GoogleButton, OrDivider } from "@/components/ui";
import { colors, type } from "@/theme";
import type { VerifyCodeResult } from "@/types/api.types";
import { useGoogleSignIn } from "./useGoogleSignIn";

/**
 * Wraps the Google hook in its own component on purpose.
 *
 * expo-auth-session's useIdTokenAuthRequest THROWS when no client id is
 * configured -- it does not return a null request. Calling it from the sign-in
 * screen would take the whole screen down on any machine without Google set
 * up. Keeping it here means the hook only ever runs when this component is
 * mounted, and the screen only mounts it when `isGoogleConfigured`.
 */
export function GoogleSignIn({
  onSuccess,
  disabled,
}: {
  onSuccess: (result: VerifyCodeResult) => void;
  disabled?: boolean;
}) {
  const google = useGoogleSignIn({ onSuccess });

  return (
    <View style={{ gap: 18 }}>
      {google.error ? <ErrorNotice message={google.error} /> : null}
      <OrDivider />
      <GoogleButton
        onPress={google.signIn}
        busy={google.busy}
        disabled={disabled || !google.available}
      />
    </View>
  );
}

/**
 * Development-only stand-in when no client id is set. Hiding the button
 * outright left people wondering where it went; this shows it disabled and
 * says what to configure. Production still hides it -- a dead button is worse
 * than none. Renders no hook, so it cannot hit the missing-client-id throw.
 */
export function GoogleSignInUnconfigured() {
  return (
    <View style={{ gap: 18 }}>
      <OrDivider />
      <GoogleButton onPress={() => undefined} disabled />
      <Text
        style={{
          ...type.caption,
          color: colors.devInk,
          textAlign: "center",
          marginTop: -10,
        }}
      >
        Dev: set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in fe/.env to enable
      </Text>
    </View>
  );
}

export { isGoogleConfigured } from "./useGoogleSignIn";
