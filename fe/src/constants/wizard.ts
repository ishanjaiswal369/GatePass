/**
 * The listing wizard's steps, in order.
 *
 * Kept in one place because each screen needs to know its own number and the
 * total, and a step added to the route tree but forgotten here would leave
 * every later screen counting wrong.
 */
export const WIZARD_STEPS = [
  // Address first, and it is the only place the address is asked for. It used
  // to be collected again by host onboarding before the wizard opened, which
  // meant a host typed it twice and the two copies were free to disagree.
  "address",
  "type",
  "photos",
  "availability",
  "pricing",
  "access",
  "documents",
  "payout",
  "review",
] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];

export const TOTAL_STEPS = WIZARD_STEPS.length;

export const stepNumber = (step: WizardStep) =>
  WIZARD_STEPS.indexOf(step) + 1;

/** Where Continue goes from a given step. */
export function nextStepPath(step: WizardStep): string {
  const next = WIZARD_STEPS[WIZARD_STEPS.indexOf(step) + 1];
  return next ? `/host/spot/${next}` : "/host/spot";
}

/** Where the wizard opens. Derived, so reordering the steps moves it too. */
export const FIRST_STEP_PATH = `/host/spot/${WIZARD_STEPS[0]}` as const;
