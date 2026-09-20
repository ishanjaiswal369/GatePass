/** A place the driver can pick when they type an area by hand. */
export interface GeocodeResult {
  /** Provider's own id, so a later detail lookup can reuse it. */
  providerPlaceId?: string;
  description: string;
  latitude: number;
  longitude: number;
}

/**
 * One type-ahead suggestion.
 *
 * Coordinates are optional because the good autocomplete APIs do not return
 * them: they answer with a place id and a label, and the coordinates cost a
 * second lookup once the user has actually picked something. Providers that
 * do return them fill these in, and the caller then skips the second call.
 */
export interface PlaceSuggestion {
  providerPlaceId?: string;
  description: string;
  latitude?: number;
  longitude?: number;
}

export interface GeocodeProvider {
  readonly name: "ola" | "google";

  /** Full-string lookup. Always returns coordinates. */
  search(
    query: string,
    near?: { latitude: number; longitude: number }
  ): Promise<GeocodeResult[]>;

  /**
   * Type-ahead suggestions. Optional: a provider without one falls back to
   * search(), which is worse per keystroke but correct.
   */
  autocomplete?(
    query: string,
    near?: { latitude: number; longitude: number },
    sessionToken?: string
  ): Promise<PlaceSuggestion[]>;

  /** Coordinates for a suggestion the user picked. */
  placeDetails?(
    placeId: string,
    sessionToken?: string
  ): Promise<GeocodeResult | null>;

  /**
   * Upstream URL for a flat map image centred on a point.
   *
   * Returned rather than fetched so the caller decides how it reaches the
   * client. Ours proxies it: the URL carries the API key, and a URL the app
   * could request directly is a key the app has to hold.
   */
  staticMapUrl?(options: StaticMapOptions): string;
}

export interface StaticMapOptions {
  latitude: number;
  longitude: number;
  zoom: number;
  width: number;
  height: number;
  /** 2 on a retina screen; the coordinate maths stays in logical pixels. */
  scale: 1 | 2;
  /** Roads, imagery, or imagery with road labels over it. */
  mapType?: "roadmap" | "satellite" | "hybrid";
}
