import { useEffect, useState } from "react";
import { API_URL } from "@/api";

/**
 * A map image for a point, fetched with the session token.
 *
 * The endpoint is authenticated, and an <Image> source cannot carry an
 * Authorization header the same way on web and native. So the bytes are
 * fetched here and handed over as a data URI, which every platform renders
 * identically. The images are tens of kilobytes and the server marks them
 * cacheable, so this costs one request per distinct square.
 */
export function useStaticMap(
  token: string | null,
  centre: { latitude: number; longitude: number } | null,
  options: { zoom: number; width: number; height: number }
) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const { zoom, width, height } = options;
  const latitude = centre?.latitude;
  const longitude = centre?.longitude;

  useEffect(() => {
    if (!token || latitude === undefined || longitude === undefined) {
      setUri(null);
      return;
    }

    let cancelled = false;

    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      zoom: String(zoom),
      width: String(width),
      height: String(height),
      scale: "2",
    });

    (async () => {
      try {
        const response = await fetch(`${API_URL}/geocode/static-map?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) throw new Error(String(response.status));

        const blob = await response.blob();
        const dataUri = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(reader.error);
          reader.onloadend = () => resolve(String(reader.result));
          reader.readAsDataURL(blob);
        });

        if (cancelled) return;
        setUri(dataUri);
        setFailed(false);
      } catch {
        if (cancelled) return;
        // The pin still works without a picture behind it -- coordinates are
        // what the step actually collects -- so this is reported, not thrown.
        setFailed(true);
        setUri(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, latitude, longitude, zoom, width, height]);

  return { uri, failed };
}
