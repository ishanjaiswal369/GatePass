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

/**
 * Ends the wizard at `href`, with the wizard's screens gone from history.
 *
 * Every step is pushed, so a submitted listing had all nine still stacked
 * under it: `replace` swapped only the last one, and Back (the phone's own
 * button included) walked a host through review, documents, access... one
 * step at a time. Popping them first means Back from here leaves for wherever
 * the wizard was opened from.
 *
 * `routes` is the root stack's, from `useNavigation().getState()`. The
 * listing's own status page counts as part of the flow, so a resubmit
 * started from it doesn't leave an old copy behind the new one.
 */
export function leaveWizard(routes: readonly { name: string }[], href: Parameters<typeof router.push>[0]): void {
  let wizard = 0;
  while (wizard < routes.length && routes[routes.length - 1 - wizard].name.startsWith("host/spot")) wizard++;

  // Something has to stay under the new screen; a wizard opened cold (a
  // reload, a link) has nothing else in history, and gets a plain replace.
  if (wizard > 0 && wizard < routes.length) {
    router.dismiss(wizard);
    router.push(href);
  } else {
    router.replace(href);
  }
}
