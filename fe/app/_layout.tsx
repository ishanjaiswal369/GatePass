import { Stack } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { BrandSplash } from "@/components/ui";
import { SessionProvider } from "@/providers/SessionProvider";

export default function RootLayout() {
  // Cold start only: the splash lives in root state, so in-app navigation
  // never brings it back.
  const [showSplash, setShowSplash] = useState(true);
  const hideSplash = useCallback(() => setShowSplash(false), []);

  return (
    <SessionProvider>
      <View style={{ flex: 1 }}>
        <Stack screenOptions={{ headerShown: false, animation: "fade" }} />
        {showSplash ? <BrandSplash onDone={hideSplash} /> : null}
      </View>
    </SessionProvider>
  );
}
