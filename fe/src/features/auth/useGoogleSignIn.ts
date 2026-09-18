import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { authApi } from "@/api";
import type { VerifyCodeResult } from "@/types/api.types";

// Closes the popup/redirect window once Google hands control back.
WebBrowser.maybeCompleteAuthSession();

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;

/**
 * True only when a client ID is configured. The button is hidden otherwise --
 * a Google button that cannot work is worse than no button.
 */
export const isGoogleConfigured = Boolean(WEB_CLIENT_ID);

/**
 * Google sign-in for the app.
 *
 * Uses useIdTokenAuthRequest, not useAuthRequest: we want an ID token (a
 * signed assertion of identity the backend can verify) rather than an access
 * token (which only grants API calls and proves nothing on its own).
 *
 * expo-auth-session is chosen over @react-native-google-signin because it is
 * not a native module, so the same code runs on web and inside Expo Go. The
 * trade-off is a browser sheet instead of the native account picker.
 */
export function useGoogleSignIn({
  onSuccess,
}: {
  onSuccess: (result: VerifyCodeResult) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: WEB_CLIENT_ID,
    iosClientId: IOS_CLIENT_ID,
    androidClientId: ANDROID_CLIENT_ID,
  });

  useEffect(() => {
    if (!response) return;

    if (response.type === "error") {
      setError("Google sign-in failed. Try again.");
      setBusy(false);
      return;
    }

    // "dismiss" and "cancel" are the user backing out -- not an error to show.
    if (response.type !== "success") {
      setBusy(false);
      return;
    }

    const idToken = response.params?.id_token;

    if (!idToken) {
      setError("Google did not return an identity token.");
      setBusy(false);
      return;
    }

    let cancelled = false;

    authApi
      .signInWithGoogle(idToken)
      .then((result) => {
        if (!cancelled) onSuccess(result);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [response, onSuccess]);

  return {
    available: Boolean(request),
    busy,
    error,
    signIn: () => {
      setError(null);
      setBusy(true);
      void promptAsync();
    },
  };
}
