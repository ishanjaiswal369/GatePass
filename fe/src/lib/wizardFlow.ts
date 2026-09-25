import { router } from "expo-router";
import { isLiveStatus, nextStepPath, type WizardStep } from "@/constants/wizard";
import type { SpotListing } from "@/types/api.types";

/**
 * Where a wizard step goes once saved.
 *
 * A draft carries on to the next step. A live space got here from its
 * dashboard (Edit prices, Access instructions, Availability...), so saving
 * returns there rather than marching the host through the rest of a wizard
 * they finished weeks ago.
 */
export function continueAfter(step: WizardStep, spot: Pick<SpotListing, "id" | "status">): void {
  if (!isLiveStatus(spot.status)) {
    router.push(nextStepPath(step, spot.id));
    return;
  }
  if (router.canGoBack()) router.back();
  else router.replace({ pathname: "/host/listing/[id]", params: { id: spot.id } });
}
