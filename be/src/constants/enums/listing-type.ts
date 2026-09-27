/**
 * What kind of place a listing is. Only one kind is sold today: a private
 * space rented out by an individual host. (Event parking, with its organizer
 * accounts and slot counts, was removed on 2026-09-27.)
 */
export const LISTING_TYPES = ["INDEPENDENT_SPOT"] as const;

export type ListingType = (typeof LISTING_TYPES)[number];

export const DEFAULT_LISTING_TYPE: ListingType = "INDEPENDENT_SPOT";
