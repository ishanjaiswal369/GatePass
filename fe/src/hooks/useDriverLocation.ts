import * as Location from "expo-location";
import { useCallback, useState } from "react";

export interface Coords {
  latitude: number;
  longitude: number;
}

type Status = "idle" | "asking" | "granted" | "denied" | "unavailable";

/**
 * Location, asked for on demand.
 *
 * Nothing here runs on mount: the permission dialog only appears when the
 * driver opens the Nearby tab and presses the button, which is the difference
 * between a prompt that gets granted and one that gets dismissed. A denial is
 * kept in state so the tab can explain itself rather than re-prompting into a
 * dialog the OS will no longer show.
 */
export function useDriverLocation() {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [status, setStatus] = useState<Status>("idle");

  const requestLocation = useCallback(async () => {
    setStatus("asking");

    try {
      const { granted } = await Location.requestForegroundPermissionsAsync();

      if (!granted) {
        setStatus("denied");
        return null;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const next = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };

      setCoords(next);
      setStatus("granted");
      return next;
    } catch {
      // A simulator with no location fix, or a browser that refuses over
      // plain http, both land here. Manual entry stays available.
      setStatus("unavailable");
      return null;
    }
  }, []);

  /** Manual area entry resolves to coordinates too. */
  const setManualCoords = useCallback((next: Coords) => {
    setCoords(next);
    setStatus("granted");
  }, []);

  return { coords, status, requestLocation, setManualCoords };
}
