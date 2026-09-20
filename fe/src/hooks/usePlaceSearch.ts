import { useCallback, useEffect, useRef, useState } from "react";
import { spotsApi } from "@/api";
import type { GeocodeResult } from "@/types/api.types";

/** Below this, a query matches half the country and the call is wasted. */
const MIN_QUERY_LENGTH = 3;

/**
 * How long typing has to stop before a request goes out.
 *
 * Place search is billed per request, so a call per keystroke is a bill per
 * keystroke. 300ms is about the gap between words rather than between letters,
 * which is where a query first becomes worth asking about.
 */
const DEBOUNCE_MS = 300;

/**
 * Type-ahead place search.
 *
 * Two things this owes the caller beyond the results themselves. Responses can
 * land out of order, so a slow request for "kot" must not overwrite the
 * results for "kothrud" -- each request carries the query it was made for and
 * is dropped if the box has moved on. And an unconfigured provider answers 503,
 * which is a deployment choice rather than something the host did wrong, so it
 * is reported separately and leaves the manual fields alone.
 */
export function usePlaceSearch(token: string | null) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  // What the box held when the in-flight request left.
  const inFlightFor = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A value the box was given rather than typed. Writing to the box is what
  // schedules a search, so without this a pick would search for the thing the
  // host just picked and reopen the list underneath their finger.
  const settledAt = useRef<string | null>(null);

  /** Takes a pick, or a typed address, without firing another search. */
  const settle = useCallback((text: string) => {
    if (timer.current) clearTimeout(timer.current);
    settledAt.current = text;
    setQuery(text);
    setResults([]);
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);

    const trimmed = query.trim();

    // Typing again clears it, so this suppresses exactly one search: the one
    // the pick itself would otherwise cause.
    if (settledAt.current !== null) {
      if (settledAt.current === query) {
        setSearching(false);
        return;
      }
      settledAt.current = null;
    }

    if (!token || trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);

    timer.current = setTimeout(async () => {
      inFlightFor.current = trimmed;

      try {
        const { results: found } = await spotsApi.geocode(token, trimmed);

        // The box moved on while this was in the air.
        if (inFlightFor.current !== trimmed) return;

        setResults(found);
        setUnavailable(false);
      } catch {
        if (inFlightFor.current !== trimmed) return;
        setUnavailable(true);
        setResults([]);
      } finally {
        if (inFlightFor.current === trimmed) setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, token]);

  return { query, setQuery, results, searching, unavailable, settle };
}
