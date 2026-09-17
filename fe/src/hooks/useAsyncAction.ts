import { useCallback, useRef, useState } from "react";
import { ApiError } from "@/api";

/**
 * Every screen runs the same shape: set busy, clear the error, call the API,
 * show a message if it fails, clear busy. This owns that so screens hold only
 * what is specific to them.
 */
export function useAsyncAction<Args extends unknown[]>(
  action: (...args: Args) => Promise<void>
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Kept in a ref so `run` has a stable identity even though callers pass a
  // fresh closure on every render.
  const actionRef = useRef(action);
  actionRef.current = action;

  const run = useCallback(async (...args: Args) => {
    setBusy(true);
    setError(null);

    try {
      await actionRef.current(...args);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Something went wrong"
      );
    } finally {
      setBusy(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { run, busy, error, clearError };
}
