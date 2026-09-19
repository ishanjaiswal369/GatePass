import { IntegrationError } from "../errors.js";
import { http, withRetry } from "../http.js";
import type { GeocodeProvider, GeocodeResult } from "./provider.js";

const CAPABILITY = "geocode";
const GEOCODE_ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";

interface GoogleGeocodeResponse {
  status?: string;
  error_message?: string;
  results?: {
    place_id?: string;
    formatted_address?: string;
    geometry?: { location?: { lat?: number; lng?: number } };
  }[];
}

/**
 * Google Geocoding. Worth the higher per-request price only if the app already
 * needs Google's global place data; for India-only search Ola covers the same
 * ground for less. Kept as an option because the project already has a Google
 * Cloud project for sign-in.
 */
export class GoogleGeocodeProvider implements GeocodeProvider {
  readonly name = "google" as const;

  constructor(private readonly apiKey: string) {}

  async search(
    query: string,
    near?: { latitude: number; longitude: number }
  ): Promise<GeocodeResult[]> {
    return withRetry(async () => {
      try {
        const response = await http.get<GoogleGeocodeResponse>(
          GEOCODE_ENDPOINT,
          {
            params: {
              address: query,
              key: this.apiKey,
              region: "in",
              ...(near
                ? { bounds: boundsAround(near.latitude, near.longitude) }
                : {}),
            },
          }
        );

        const { status, results, error_message: errorMessage } = response.data;

        // Google answers HTTP 200 with a status string, so a quota or key
        // failure looks like success to axios and has to be checked here.
        if (status && status !== "OK" && status !== "ZERO_RESULTS") {
          throw new IntegrationError(errorMessage ?? status, {
            capability: CAPABILITY,
            provider: "google",
            operation: "geocode",
            retryable: status === "OVER_QUERY_LIMIT",
          });
        }

        return (results ?? []).flatMap((result) => {
          const lat = result.geometry?.location?.lat;
          const lng = result.geometry?.location?.lng;

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
          { capability: CAPABILITY, provider: "google", operation: "geocode" },
          error
        );
      }
    });
  }
}

/** Biases results towards roughly 50km around the driver. */
function boundsAround(latitude: number, longitude: number): string {
  const delta = 0.45;
  return `${latitude - delta},${longitude - delta}|${latitude + delta},${longitude + delta}`;
}
