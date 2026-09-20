import { useCallback, useEffect, useState } from "react";
import { ApiError, spotListingApi } from "@/api";
import { useSession } from "@/providers/SessionProvider";
import type { SpotListing } from "@/types/api.types";

/**
 * The host's spot as the server currently holds it.
 *
 * Every wizard step reads through this rather than passing state between
 * screens. The server is the only copy that matters -- it is what a host
 * returns to on a new device, and what the review step is judged against --
 * so a screen that trusted navigation params would be showing something the
 * API might already disagree with.
 */
export function useSpotDraft() {
  const { token, isRestoring } = useSession();
  const [spot, setSpot] = useState<SpotListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;

    setLoading(true);
    setError(null);

    try {
      const { spots } = await spotListingApi.list(token);
      const current = spots[0] ?? null;

      // The list projection omits availability; the single read carries it,
      // and the availability step needs it.
      setSpot(
        current ? await spotListingApi.getById(token, current.id) : null
      );
    } catch (err) {
      // 403 means this user is not a host yet, which is the expected state on
      // the first step -- the profile is created by the address step. Anything
      // else is a real failure worth showing.
      if (err instanceof ApiError && err.status === 403) {
        setSpot(null);
      } else {
        setError("Could not load your spot");
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (isRestoring) return;
    void load();
  }, [isRestoring, load]);

  return { spot, setSpot, loading, error, reload: load, token, isRestoring };
}
