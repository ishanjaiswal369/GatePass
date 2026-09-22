import { useLocalSearchParams } from "expo-router";
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
 *
 * A host can list more than one spot, so which one is "the" spot for this
 * screen is not a fixed fact -- it comes from the route's own `?id=` query
 * param (see wizard.ts's nextStepPath/firstStepPath, which carry it forward
 * from screen to screen). Reading it here, rather than in every screen, means
 * no wizard screen has to know this hook is id-aware at all.
 *
 * No id means no spot. It used to mean "whichever one the host touched
 * first", which was harmless when a host had one; now that the first step
 * creates a spot, that fallback would have "add another spot" open the
 * existing one and rename it.
 */
export function useSpotDraft() {
  const { token, user, isRestoring } = useSession();
  const { id } = useLocalSearchParams<{ id?: string }>();
  // Known before any request: /host/spots is behind requireHost, so asking as
  // a non-host is a 403 by design rather than a failure worth making.
  const isHost = user?.hasHostProfile;
  const [spot, setSpot] = useState<SpotListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;

    // Nothing to load: a spot the host has not created yet (the first step
    // creates it), or a user who is not a host, for whom every call here
    // would be a guaranteed 403.
    if (!id || isHost === false) {
      setSpot(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setSpot(await spotListingApi.getById(token, id));
    } catch (err) {
      // 403 means this user is not a host yet, which is the expected state on
      // the first step -- the profile is created alongside the listing. 404
      // means a stale or foreign id in the URL. Anything else is a real
      // failure worth showing.
      if (
        err instanceof ApiError &&
        (err.status === 403 || err.status === 404)
      ) {
        setSpot(null);
      } else {
        setError("Could not load your spot");
      }
    } finally {
      setLoading(false);
    }
  }, [token, isHost, id]);

  useEffect(() => {
    if (isRestoring) return;
    void load();
  }, [isRestoring, load]);

  return { spot, setSpot, loading, error, reload: load, token, isRestoring };
}
