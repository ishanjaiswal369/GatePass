/** A place the driver can pick when they type an area by hand. */
export interface GeocodeResult {
  /** Provider's own id, so a later detail lookup can reuse it. */
  providerPlaceId?: string;
  description: string;
  latitude: number;
  longitude: number;
}

export interface GeocodeProvider {
  readonly name: "ola" | "google";
  search(query: string, near?: { latitude: number; longitude: number }): Promise<GeocodeResult[]>;
}
