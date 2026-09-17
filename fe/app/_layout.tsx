import { Stack } from "expo-router";
import { SessionProvider } from "@/providers/SessionProvider";

export default function RootLayout() {
  return (
    <SessionProvider>
      <Stack screenOptions={{ headerShown: false, animation: "fade" }} />
    </SessionProvider>
  );
}
