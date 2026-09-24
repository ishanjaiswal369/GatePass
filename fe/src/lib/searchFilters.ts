import { AMENITIES, type Amenity } from "@/constants/enums";
import type { SpaceType } from "@/types/api.types";

/**
 * Filters on a search, carried in the URL beside the criteria.
 *
 * Same reasoning as the criteria: results are the screen a driver reloads or
 * shares, and a filter held in memory would silently vanish on either. Only
 * non-default values are written, so an unfiltered search keeps a short URL.
 */

export interface SearchFilters {
  amenities: Amenity[];
  spaceTypes: SpaceType[];
  maxPricePerHour: number | null;
  open24x7: boolean;
  sort: "distance" | "price";
  /** How far from the destination, in km. */
  radiusKm: number;
}

export const RADIUS_CHOICES = [1, 2, 5, 15];

export const NO_FILTERS: SearchFilters = {
  amenities: [],
  spaceTypes: [],
  maxPricePerHour: null,
  open24x7: false,
  sort: "distance",
  radiusKm: 5,
};

const SPACE_TYPES: SpaceType[] = ["DRIVEWAY", "GARAGE", "CAR_PARK", "OTHER"];

export function filtersToParams(filters: SearchFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (filters.amenities.length) out.amenities = filters.amenities.join(",");
  if (filters.spaceTypes.length) out.types = filters.spaceTypes.join(",");
  if (filters.maxPricePerHour !== null) out.maxPrice = String(filters.maxPricePerHour);
  if (filters.open24x7) out.open247 = "1";
  if (filters.sort !== "distance") out.sort = filters.sort;
  if (filters.radiusKm !== NO_FILTERS.radiusKm) out.radius = String(filters.radiusKm);
  return out;
}

/** Unknown values are dropped rather than failing the whole search. */
export function filtersFromParams(params: Record<string, string | string[] | undefined>): SearchFilters {
  const read = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const list = (key: string) => (read(key) ?? "").split(",").filter(Boolean);
  const max = Number(read("maxPrice"));
  const radius = Number(read("radius"));

  return {
    amenities: list("amenities").filter((a): a is Amenity => (AMENITIES as readonly string[]).includes(a)),
    spaceTypes: list("types").filter((t): t is SpaceType => (SPACE_TYPES as string[]).includes(t)),
    maxPricePerHour: Number.isFinite(max) && max > 0 ? max : null,
    open24x7: read("open247") === "1",
    sort: read("sort") === "price" ? "price" : "distance",
    radiusKm: RADIUS_CHOICES.includes(radius) ? radius : NO_FILTERS.radiusKm,
  };
}

/** How many filters narrow the search -- the number on the Filters button. Sort isn't one. */
export function activeFilterCount(filters: SearchFilters): number {
  return (
    filters.amenities.length +
    filters.spaceTypes.length +
    (filters.maxPricePerHour !== null ? 1 : 0) +
    (filters.open24x7 ? 1 : 0) +
    (filters.radiusKm !== NO_FILTERS.radiusKm ? 1 : 0)
  );
}

/**
 * Every filter key, with "" for defaults -- for `router.setParams`, which
 * merges: writing only the non-defaults would leave a cleared filter behind.
 */
export function filtersToAllParams(filters: SearchFilters): Record<string, string> {
  return { amenities: "", types: "", maxPrice: "", open247: "", sort: "", radius: "", ...filtersToParams(filters) };
}
