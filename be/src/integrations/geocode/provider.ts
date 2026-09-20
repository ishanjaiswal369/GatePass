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
}
