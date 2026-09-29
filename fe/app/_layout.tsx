import { Stack } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BrandSplash } from "@/components/ui";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { SessionProvider } from "@/providers/SessionProvider";

/** Needs the session, so it lives inside the provider rather than in RootLayout itself. */
function PushNotifications() {
  usePushNotifications();
  return null;
}

export default function RootLayout() {
  // Cold start only: the splash lives in root state, so in-app navigation
  // never brings it back.
  const [showSplash, setShowSplash] = useState(true);
  const hideSplash = useCallback(() => setShowSplash(false), []);

  return (
    // SafeAreaProvider has to wrap everything: useSafeAreaInsets returns zeroes
    // outside it, which looks fine on web and clips under the notch on a phone.
    <SafeAreaProvider>
      <SessionProvider>
        <PushNotifications />
        <View style={{ flex: 1 }}>
          <Stack screenOptions={{ headerShown: false, animation: "fade" }} />
          {showSplash ? <BrandSplash onDone={hideSplash} /> : null}
        </View>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
