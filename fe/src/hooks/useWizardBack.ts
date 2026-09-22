import { router } from "expo-router";
import { useCallback } from "react";
import { prevStepPath, type WizardStep } from "@/constants/wizard";

/**
 * Back, for a wizard step.
 *
 * `router.back()` needs somewhere to go back to, and a wizard step does not
 * always have one: every step is its own URL, so a host can arrive at one
 * cold from a reload, a shared link, or a `replace` that ended the flow
 * before it. There the button did nothing at all, which reads as broken
 * rather than as "nothing behind this".
 *
 * Falling back to the previous step's own path means Back always moves, and
 * moves to the same place either way -- history just gets there without
 * re-rendering the screen underneath.
 */
export function useWizardBack(step: WizardStep, id?: string) {
  return useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace(prevStepPath(step, id));
  }, [step, id]);
}
