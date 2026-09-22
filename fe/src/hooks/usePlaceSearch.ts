import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, spotsApi } from "@/api";
import type { PlaceSuggestion } from "@/types/api.types";

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
 * Opaque to us and to the server; the provider only requires that it is
 * stable across one search and not reused afterwards.
 */
function newSessionToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

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
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  /**
   * Why search is not working, if it is not.
   *
   * Not a boolean: "nobody configured a provider" and "the provider rejected
   * us" look identical to a host but are opposite problems to whoever is
   * running the server, and a single "search is off" hides which one it is.
   */
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);

  // What the box held when the in-flight request left.
  const inFlightFor = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A value the box was given rather than typed. Writing to the box is what
  // schedules a search, so without this a pick would search for the thing the
  // host just picked and reopen the list underneath their finger.
  const settledAt = useRef<string | null>(null);
  /**
   * One token per search, from the first keystroke to the pick.
   *
   * This is what makes a burst of keystrokes and the details call that follows
   * bill as a single session rather than as one request each -- the difference
   * between a few paise and a few rupees per address a host enters.
   */
  const session = useRef(newSessionToken());

  /** Takes a pick, or a typed address, without firing another search. */
  const settle = useCallback((text: string) => {
    if (timer.current) clearTimeout(timer.current);
    settledAt.current = text;
    setQuery(text);
    setResults([]);
    // The session ends with the pick; the next search is a new one.
    session.current = newSessionToken();
  }, []);

  /** The token the details call for a pick has to carry to close the session. */
  const sessionToken = useCallback(() => session.current, []);

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
        const { suggestions } = await spotsApi.autocomplete(token, trimmed, {
          sessionToken: session.current,
        });

        // The box moved on while this was in the air.
        if (inFlightFor.current !== trimmed) return;

        setResults(suggestions);
        setUnavailableReason(null);
      } catch (err) {
        if (inFlightFor.current !== trimmed) return;

        // Logged as well as shown: the message a host sees has to be short,
        // and the one that explains a misconfiguration does not fit in a hint.
        console.warn("place search failed", err);

        setUnavailableReason(
          err instanceof ApiError && err.status === 503
            ? "Address search is not set up on the server yet."
            : "Address search is not responding right now."
        );
        setResults([]);
      } finally {
        if (inFlightFor.current === trimmed) setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, token]);

  return {
    query,
    setQuery,
    results,
    searching,
    unavailableReason,
    settle,
    sessionToken,
  };
}
