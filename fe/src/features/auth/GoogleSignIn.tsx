import { View } from "react-native";
import { ErrorNotice, GoogleButton, OrDivider } from "@/components/ui";
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

export { isGoogleConfigured } from "./useGoogleSignIn";
