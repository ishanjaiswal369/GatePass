import raw from "./content.json";

/**
 * The public pages -- About, Contact, Terms, Privacy, Refunds, Shipping --
 * read from one JSON file. The app renders them at /about, /contact, ...;
 * `fe/scripts/build-legal-site.mjs` renders the same file into the static
 * site under docs/. One source, so the two can never say different things.
 *
 * Text may hold `{placeholders}` (keys of `business`) and `[label](target)`
 * links, where a target is an app path ("/refund") or a mailto: address.
 */

export type LegalSlug = "about" | "contact" | "terms" | "privacy" | "refund" | "shipping";

export type LegalBlock = string | { list: string[] } | { rows: [string, string][] };

export interface LegalPageContent {
  slug: LegalSlug;
  title: string;
  /** Its name in a page footer. */
  nav: string;
  /** Its name where space is tight: the sign-in screen. */
  short: string;
  intro: string;
  sections: { heading: string; blocks: LegalBlock[] }[];
}

type Business = typeof raw.business;

export const business: Business = raw.business;

const pages = raw.pages as LegalPageContent[];

/** Footer order. */
export const legalPages: readonly LegalPageContent[] = pages;

export function legalPage(slug: LegalSlug): LegalPageContent {
  const page = pages.find((p) => p.slug === slug);
  if (!page) throw new Error(`No legal page "${slug}"`);
  return page;
}

/** Fills `{brand}`, `{email}`, ... from `business`. An unknown key is left as written. */
export function fill(text: string): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in business ? business[key as keyof Business] : whole
  );
}

export type InlinePart = { text: string } | { text: string; href: string };

/** Splits filled text into plain runs and `[label](href)` links. */
export function inlineParts(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const pattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  const filled = fill(text);
  let at = 0;

  for (const match of filled.matchAll(pattern)) {
    if (match.index! > at) parts.push({ text: filled.slice(at, match.index) });
    parts.push({ text: match[1]!, href: match[2]! });
    at = match.index! + match[0].length;
  }
  if (at < filled.length) parts.push({ text: filled.slice(at) });

  return parts;
}

/** "GatePass is operated by Ishan Jaiswal (sole proprietor), Lucknow, ..." -- footers and the sign-in screen. */
export const operatorLine = `${business.brand} is operated by ${business.legalName} (sole proprietor), ${business.city}, ${business.state}, ${business.country}.`;
