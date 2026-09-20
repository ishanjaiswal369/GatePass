import { IntegrationError } from "../errors.js";
import { http, withRetry } from "../http.js";
import type {
  AddressParts,
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

interface GoogleAddressComponent {
  long_name?: string;
  short_name?: string;
  types?: string[];
}

interface GoogleGeocodeResult {
  place_id?: string;
  formatted_address?: string;
  address_components?: GoogleAddressComponent[];
  geometry?: { location?: { lat?: number; lng?: number } };
}

interface GoogleGeocodeResponse {
  status?: string;
  error_message?: string;
  results?: GoogleGeocodeResult[];
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
    const results = await geocodeImpl(this.apiKey, {
      address: query,
      region: "in",
      ...(near ? { bounds: boundsAround(near.latitude, near.longitude) } : {}),
    });

    // A match Google gave no formatted address for would otherwise be a blank
    // row in the suggestion list. What was typed is a better label than
    // nothing, and it is still a real result with real coordinates.
    return results.map((result) =>
      result.description ? result : { ...result, description: query }
    );
  }

  /**
   * The address at a point.
   *
   * The plain Geocoding API rather than a Places lookup: it is the API this
   * provider already needs enabled, it answers with address_components in the
   * same response, and its price does not depend on which fields are asked
   * for -- so the parts a listing stores come back for the cost of the call
   * that was needed anyway.
   */
  async reverseGeocode(
    latitude: number,
    longitude: number
  ): Promise<GeocodeResult | null> {
    // Google describes one point at every scale it knows, from the building up
    // to the country, most specific first. No result_type filter: it can rule
    // out every row -- open ground has no street address -- and a coarse
    // answer still beats showing a driver a pair of numbers.
    const results = await geocodeImpl(this.apiKey, {
      latlng: `${latitude},${longitude}`,
    });

    const best = results[0];
    if (!best) return null;

    // The pin is what the host placed; the lookup only names it. Returning
    // Google's snapped coordinates instead would quietly move the pin off the
    // gate and onto the middle of the road it matched.
    return { ...best, latitude, longitude };
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
      // Roads by default: an entrance is easier to aim at against a street
      // than against a roof. Hosts who recognise their own place from above
      // can switch, which is what the caller passes this for.
      maptype: options.mapType ?? "roadmap",
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

/**
 * One call to the Geocoding API, forward or reverse.
 *
 * Both directions hit the same endpoint with the same failure modes -- the one
 * that matters is that Google answers HTTP 200 with a status string, so a
 * rejected key looks like success to axios unless it is checked here.
 */
async function geocodeImpl(
  apiKey: string,
  params: Record<string, string>
): Promise<GeocodeResult[]> {
  return withRetry(async () => {
    try {
      const response = await http.get<GoogleGeocodeResponse>(GEOCODE_ENDPOINT, {
        params: { ...params, key: apiKey },
      });

      const { status, results, error_message: errorMessage } = response.data;

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
            description: result.formatted_address ?? "",
            latitude: lat,
            longitude: lng,
            address: toAddressParts(
              result.address_components,
              result.formatted_address
            ),
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

/**
 * Google's address components, in the shape a listing stores.
 *
 * The three tail fields come straight off the component types. The street line
 * does not: there is no single component for it, and hand-joining premise,
 * route and the sublocality levels gets the order wrong as often as right.
 * Google already wrote the address in the right order in formatted_address, so
 * that is what is used, with the parts broken out below removed from the end
 * of it -- the city, state, PIN and country would otherwise appear twice, once
 * in the street line and once in their own field.
 */
function toAddressParts(
  components: GoogleAddressComponent[] | undefined,
  formattedAddress: string | undefined
): AddressParts | undefined {
  if (!components?.length) return undefined;

  const pick = (type: string): string | undefined =>
    components.find((component) => component.types?.includes(type))?.long_name;

  // locality is the city nearly everywhere in India. The two fallbacks are for
  // addresses outside a municipality, where Google names the tehsil or the
  // district instead and there is no locality at all.
  const city =
    pick("locality") ??
    pick("administrative_area_level_3") ??
    pick("administrative_area_level_2");
  const state = pick("administrative_area_level_1");
  const pincode = pick("postal_code");
  const country = pick("country");

  const norm = (value: string) => value.trim().toLowerCase();
  const tail = new Set(
    [city, state, pincode, country]
      .filter((value): value is string => Boolean(value))
      .map(norm)
  );

  const drop = (segment: string): boolean => {
    const value = norm(segment);

    if (!value) return true;
    if (tail.has(value)) return true;
    // Google writes the state and the PIN as one segment: "Uttar Pradesh 208001".
    if (state && pincode && value === norm(`${state} ${pincode}`)) return true;

    return false;
  };

  const addressLine = (formattedAddress ?? "")
    .split(",")
    .map((segment) => segment.trim())
    .filter((segment) => !drop(segment))
    .join(", ");

  return {
    // Empty rather than undefined would blank a field the host filled in by
    // hand, and an address that is only a city genuinely has no street line.
    addressLine: addressLine || undefined,
    city,
    state,
    pincode,
  };
}

/** Biases results towards roughly 50km around the driver. */
function boundsAround(latitude: number, longitude: number): string {
  const delta = 0.45;
  return `${latitude - delta},${longitude - delta}|${latitude + delta},${longitude + delta}`;
}
