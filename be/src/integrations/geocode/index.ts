import { env } from "../../config/env.js";
import { serviceUnavailable } from "../../lib/errors.js";
import { GoogleGeocodeProvider } from "./google.js";
import { OlaGeocodeProvider } from "./ola.js";
import type { GeocodeProvider } from "./provider.js";

let cached: GeocodeProvider | undefined;

/**
 * Returns the configured provider, or refuses with a 503.
 *
 * Unconfigured is the default so the server still boots without a maps
 * account; the Nearby tab's manual-entry field is the only caller, and it can
 * show "not available" without taking the rest of the app down.
 */
export function getGeocodeProvider(): GeocodeProvider {
  if (cached) {
    return cached;
  }

  switch (env.GEOCODE_PROVIDER) {
    case "ola":
      cached = new OlaGeocodeProvider(env.OLA_MAPS_API_KEY!);
      break;
    case "google":
      cached = new GoogleGeocodeProvider(env.GOOGLE_MAPS_API_KEY!);
      break;
    default:
      throw serviceUnavailable("Place search is not configured");
  }

  return cached;
}

export type { GeocodeProvider, GeocodeResult } from "./provider.js";
