import { useEffect, useState } from "react";

/**
 * The current time, refreshed on an interval, for screens that count down.
 * A remaining-time label that only updates on navigation reads as frozen.
 */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);

  return now;
}
