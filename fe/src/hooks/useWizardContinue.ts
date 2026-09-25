import { router, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { stepHref, type WizardStep } from "@/constants/wizard";
import { continueAfter } from "@/lib/wizardFlow";
import type { SpotListing } from "@/types/api.types";

/**
 * Continue, for a wizard step.
 *
 * Opened from the review screen's Edit (`?from=review`), a step returns
 * there once saved -- the host was fixing one thing, not starting the rest
 * of the wizard again. Otherwise it's `continueAfter`: the next step for a
 * draft, back to the dashboard for a live space.
 */
export function useWizardContinue(step: WizardStep) {
  const { from } = useLocalSearchParams<{ from?: string }>();

  return useCallback(
    (spot: Pick<SpotListing, "id" | "status">) => {
      if (from === "review") {
        if (router.canGoBack()) router.back();
        else router.replace(stepHref("review", spot.id));
        return;
      }
      continueAfter(step, spot);
    },
    [from, step]
  );
}
