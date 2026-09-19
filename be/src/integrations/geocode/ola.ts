import { IntegrationError } from "../errors.js";
import { http, withRetry } from "../http.js";
import type { GeocodeProvider, GeocodeResult } from "./provider.js";

const CAPABILITY = "geocode";
const GEOCODE_ENDPOINT = "https://api.olamaps.io/places/v1/geocode";

interface OlaGeocodeResponse {
  geocodingResults?: {
    place_id?: string;
    formatted_address?: string;
    geometry?: { location?: { lat?: number; lng?: number } };
  }[];
}

/**
 * Ola Maps. India-only coverage, which is all this product needs, at a free
 * tier that a pre-launch app will not leave. Swappable: everything downstream
 * depends on GeocodeProvider, not on this class.
 */
export class OlaGeocodeProvider implements GeocodeProvider {
  readonly name = "ola" as const;

  constructor(private readonly apiKey: string) {}

  async search(query: string): Promise<GeocodeResult[]> {
    return withRetry(async () => {
      try {
        const response = await http.get<OlaGeocodeResponse>(GEOCODE_ENDPOINT, {
          params: { address: query, api_key: this.apiKey },
        });

        return (response.data.geocodingResults ?? []).flatMap((result) => {
          const lat = result.geometry?.location?.lat;
          const lng = result.geometry?.location?.lng;

          // A result without coordinates cannot be used to search, so it is
          // dropped rather than returned as a tappable row that does nothing.
          if (typeof lat !== "number" || typeof lng !== "number") {
            return [];
          }

          return [
            {
              providerPlaceId: result.place_id,
              description: result.formatted_address ?? query,
              latitude: lat,
              longitude: lng,
            },
          ];
        });
      } catch (error) {
        throw IntegrationError.from(
          { capability: CAPABILITY, provider: "ola", operation: "geocode" },
          error
        );
      }
    });
  }
}
