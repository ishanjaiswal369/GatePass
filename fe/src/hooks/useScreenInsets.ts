import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Safe-area padding for screens, with the web case handled.
 *
 * On a device these are the real insets: without them a dark header slides
 * under the notch or Dynamic Island, and the bottom nav sits under the home
 * indicator. On web there is no notch, but the app renders inside PhoneFrame's
 * simulated handset, so a fixed value stands in for the status bar and keeps
 * the browser layout matching the design.
 *
 * Screens add their own spacing on top of these -- the inset is the untouchable
 * strip, not the padding.
 */
export function useScreenInsets(): { top: number; bottom: number } {
  const insets = useSafeAreaInsets();

  if (Platform.OS === "web") {
    return { top: 24, bottom: 0 };
  }

  return { top: insets.top, bottom: insets.bottom };
}
