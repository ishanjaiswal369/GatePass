import { badRequest } from "./errors.js";

/**
 * Normalises a registration number for storage: uppercase, no separators.
 *
 * The check is deliberately loose. Indian plates are not one format -- the
 * common state series (MH01AB1234), the newer BH series (22BH1234AA),
 * three-character district codes and older short numbers all differ, and a
 * strict regex rejects real plates, which is a far worse failure than storing
 * an odd one. Length and character class are the parts worth enforcing.
 */
export function normaliseVehicleNumber(input: string): string {
  const cleaned = input.toUpperCase().replace(/[\s-]/g, "");

  if (!/^[A-Z0-9]{6,12}$/.test(cleaned)) {
    throw badRequest("Enter a valid vehicle number, like MH01AB1234");
  }

  return cleaned;
}
