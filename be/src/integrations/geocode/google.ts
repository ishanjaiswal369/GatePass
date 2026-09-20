import { IntegrationError } from "../errors.js";
import { http, withRetry } from "../http.js";
import type {
  GeocodeProvider,
  GeocodeResult,
  PlaceSuggestion,
  StaticMapOptions,
} from "./provider.js";

const CAPABILITY = "geocode";
const GEOCODE_ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";

/**
 * Places API (New). The legacy Place Autocomplete was closed to new customers
 * on 1 March 2025, so a project created today can only use this one -- and it
 * is a separate API to enable in the Cloud console ("Places API (New)"), on
 * top of the Geocoding API that search() uses.
 */
const AUTOCOMPLETE_ENDPOINT =
  "https://places.googleapis.com/v1/places:autocomplete";
const PLACE_ENDPOINT = "https://places.googleapis.com/v1/places";
/** Maps Static API -- a third API to enable, separate from Places and Geocoding. */
const STATIC_MAP_ENDPOINT = "https://maps.googleapis.com/maps/api/staticmap";

interface AutocompleteResponse {
  suggestions?: {
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
    };
  }[];
}

interface PlaceDetailsResponse {
  id?: string;
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
}

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

  autocomplete(
    query: string,
    near?: { latitude: number; longitude: number },
    sessionToken?: string
  ): Promise<PlaceSuggestion[]> {
    return autocompleteImpl(this.apiKey, query, near, sessionToken);
  }

  placeDetails(
    placeId: string,
    sessionToken?: string
  ): Promise<GeocodeResult | null> {
    return placeDetailsImpl(this.apiKey, placeId, sessionToken);
  }

  staticMapUrl(options: StaticMapOptions): string {
    const params = new URLSearchParams({
      center: `${options.latitude},${options.longitude}`,
      zoom: String(options.zoom),
      size: `${options.width}x${options.height}`,
      scale: String(options.scale),
      // Satellite would show the roof rather than the road, which is the wrong
      // thing to aim a pin at; the entrance is the point of this step.
      maptype: "roadmap",
      key: this.apiKey,
    });

    return `${STATIC_MAP_ENDPOINT}?${params}`;
  }
}

/**
 * Type-ahead suggestions.
 *
 * Returns no coordinates on purpose: this endpoint does not carry them, and
 * fetching them for every suggestion would mean a Place Details call per row
 * the user never picked. placeDetails() gets them once, for the one they did.
 *
 * The session token is what makes a burst of keystrokes plus the final
 * details call bill as one session rather than as N separate requests, so it
 * is threaded through rather than left to the caller to remember.
 */
async function autocompleteImpl(
  apiKey: string,
  query: string,
  near?: { latitude: number; longitude: number },
  sessionToken?: string
): Promise<PlaceSuggestion[]> {
  return withRetry(async () => {
    try {
      const response = await http.post<AutocompleteResponse>(
        AUTOCOMPLETE_ENDPOINT,
        {
          input: query,
          regionCode: "IN",
          ...(sessionToken ? { sessionToken } : {}),
          ...(near
            ? {
                locationBias: {
                  circle: {
                    center: {
                      latitude: near.latitude,
                      longitude: near.longitude,
                    },
                    radius: 50000,
                  },
                },
              }
            : {}),
        },
        { headers: { "X-Goog-Api-Key": apiKey } }
      );

      return (response.data.suggestions ?? []).flatMap((suggestion) => {
        const prediction = suggestion.placePrediction;
        const description = prediction?.text?.text;

        // A row with no label is not tappable and a row with no id cannot be
        // resolved to a pin, so neither is worth showing.
        if (!description || !prediction?.placeId) {
          return [];
        }

        return [{ providerPlaceId: prediction.placeId, description }];
      });
    } catch (error) {
      throw IntegrationError.from(
        { capability: CAPABILITY, provider: "google", operation: "autocomplete" },
        error
      );
    }
  });
}

/** Coordinates for one picked suggestion. */
async function placeDetailsImpl(
  apiKey: string,
  placeId: string,
  sessionToken?: string
): Promise<GeocodeResult | null> {
  return withRetry(async () => {
    try {
      const response = await http.get<PlaceDetailsResponse>(
        `${PLACE_ENDPOINT}/${encodeURIComponent(placeId)}`,
        {
          headers: {
            "X-Goog-Api-Key": apiKey,
            // Billing is per field group, so asking for everything costs more
            // than asking for the two things a pin needs.
            "X-Goog-FieldMask": "id,formattedAddress,location",
          },
          params: sessionToken ? { sessionToken } : undefined,
        }
      );

      const lat = response.data.location?.latitude;
      const lng = response.data.location?.longitude;

      if (typeof lat !== "number" || typeof lng !== "number") {
        return null;
      }

      return {
        providerPlaceId: response.data.id ?? placeId,
        description: response.data.formattedAddress ?? "",
        latitude: lat,
        longitude: lng,
      };
    } catch (error) {
      throw IntegrationError.from(
        { capability: CAPABILITY, provider: "google", operation: "placeDetails" },
        error
      );
    }
  });
}

/** Biases results towards roughly 50km around the driver. */
function boundsAround(latitude: number, longitude: number): string {
  const delta = 0.45;
  return `${latitude - delta},${longitude - delta}|${latitude + delta},${longitude + delta}`;
}
